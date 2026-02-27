const express = require('express');
const app = express();
const amqp = require('amqplib');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const PORT = 5001;

const DOCTOR_SERVICE_URL = process.env.DOCTOR_SERVICE_URL || 'http://doctor-service:5001';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';

app.use(bodyParser.json());

app.post('/appointments', async (req, res) => {
    try {
        const {  patient_name, patient_email, doctor_id, reason } = req. body;

        if(!patient_name || !patient_email || !doctor_id || !reason) {
            return res.status(400).json({ error: "Missing required fields (at least one): patient_name, patient_email, doctor_id, reason"});
        }

        try {
            const doctorResponse = await axios.post(`${DOCTOR_SERVICE_URL}/doctors/${doctor_id}/reserve`, { slots: 1});

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

            await publishToRabbitMQ(appointment);

            return res.status(201).json({
                "appointment_id": appointment.id,
                "status": "confirmed",
                "message": `Appointment confirmed with ${appointment.doctor_name} has been booked.`
            });
        }
        catch (doctorError) {
            if(doctorError.response) {
                if(doctorError.response.status === 409) {
                    return res.status(409).json({
                        "status": "rejected",
                        "reason": doctorError.response.data.reason
                    });
                }
                
            }

        }
    }
    catch (error) {
        console.error('Error creating appointment:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }


});

async function publishToRabbitMQ(appointment) {
    let connection = null;
    let channel = null;

    try {
        connection = await connectWithRetry(RABBITMQ_URL);
        channel = await connection.createChannel();

        const exchange = 'appts';
        await channel.asserExchange(exchange, 'fanout', { durable: false });

        channel.publish(exchange, '', Buffer.from(JSON.stringify(appointment)));

        console.log('Appointment published to RabbitMQ:', appointment);
    }
    catch (error) {
        console.error('Error publishing to RabbitMQ:', error);
    }
    finally {
        if(channel) await channel.close();
        if(connection) await connection.close();
    }

}

app.listen(PORT, () => {
    console.log(`Appointment service running on port ${PORT}`);
    console.log(`Doctor service URL: ${DOCTOR_SERVICE_URL}`);
    console.log(`RabbitMQ URL: ${RABBITMQ_URL}`);
});