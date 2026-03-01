const express = require('express');
const app = express();
const amqp = require('amqplib');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const PORT = 5001;


const DOCTOR_SERVICE_URL = process.env.DOCTOR_SERVICE_URL || 'http://doctor-service:5002';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';

app.use(bodyParser.json());


async function connectWithRetry(url, retries = 5, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            const connection = await amqp.connect(url);
            console.log('Connected to RabbitMQ');
            return connection;
        } catch (err) {
            console.log(`Connection attempt ${i + 1} failed: ${err.message}`);
            if (i === retries - 1) throw err;
            console.log(`Retrying in ${delay/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function publishToRabbitMQ(appointment) {
    let connection = null;
    let channel = null;

    try {
        connection = await connectWithRetry(RABBITMQ_URL);
        channel = await connection.createChannel();

        const exchange = 'appts';
        
        await channel.assertExchange(exchange, 'fanout', { durable: false });

        channel.publish(exchange, '', Buffer.from(JSON.stringify(appointment)));

        console.log('Appointment published to RabbitMQ:', appointment.id);
    }
    catch (error) {
        console.error('Error publishing to RabbitMQ:', error);
    }
    finally {
        if(channel) await channel.close();
        if(connection) await connection.close();
    }
}

app.post('/appointments', async (req, res) => {
    try {
        const { patient_name, patient_email, doctor_id, reason } = req.body;
        console.log('Received appointment request:', { patient_name, patient_email, doctor_id, reason });
        
        if(!patient_name || !patient_email || !doctor_id || !reason) {
            return res.status(400).json({ error: "Missing required fields: patient_name, patient_email, doctor_id, reason"});
        }

        try {
            console.log(`🔍 Calling Doctor Service at ${DOCTOR_SERVICE_URL}/doctors/${doctor_id}/reserve`);
            const doctorResponse = await axios.post(`${DOCTOR_SERVICE_URL}/doctors/${doctor_id}/reserve`, { slots: 1 });

            console.log('Doctor service response:', doctorResponse.data);

            if(!doctorResponse.data.success) {
                return res.status(409).json({
                    "success": false,
                    "reason": doctorResponse.data.reason
                });
            }

            const appointment = {
                id: uuidv4(),
                patient_name,
                patient_email,
                doctor_id,
                doctor_name: doctorResponse.data.doctor_name,
                reason,
                timestamp: new Date().toISOString()
            };

            
            publishToRabbitMQ(appointment).catch(err => 
                console.error('Background RabbitMQ error:', err)
            );

            return res.status(201).json({
                "appointment_id": appointment.id,
                "status": "confirmed",
                "message": `Appointment confirmed with ${appointment.doctor_name}`
            });
        }
        catch (doctorError) {
            console.error('Doctor service error:', {
                message: doctorError.message,
                response: doctorError.response?.data,
                status: doctorError.response?.status
            });
            
            if(doctorError.response) {
                if(doctorError.response.status === 409) {
                    return res.status(409).json({
                        "status": "rejected",
                        "reason": doctorError.response.data.reason
                    });
                }
            }
            
            return res.status(500).json({ 
                error: 'Doctor service error',
                details: doctorError.message 
            });
        }
    }
    catch (error) {
        console.error('Error creating appointment:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(` Appointment service running on port ${PORT}`);
    console.log(`Doctor service URL: ${DOCTOR_SERVICE_URL}`);
    console.log(`RabbitMQ URL: ${RABBITMQ_URL}`);
});