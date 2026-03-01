const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';

const appointmentRecords = [];

async function main() {
    const connection = await amqp.connect(RABBITMQ_URL || "amqp://localhost");
    const channel = await connection.createChannel();
    await channel.asserQueue('records', { durable: false});

    await channel.precheck(1);
    await channel.assertExchange('appts', 'fanout', { durable: false});
    await channel.bindQueue('records', 'appts', '');

    channel.consume('records', (msg) => {
        try {
            const msgContent = msg.content.toString();
            const appointmentData = JSON.parse(msgContent);

            appointmentRecords.push({
                email: appointmentData.patient_email,
                doctor: appointmentData.doctor_name,
                reason: appointmentData.reason,
                timestamp: appointmentData.timestamp
            });

            console.log(`[Records] New appointment logged - total on record: ${appointmentRecords.length}`);

            appointmentRecords.forEach((record, index) => {
                console.log(` ${record.email} -> ${record.doctor} (${record.reason}) at ${record.timestamp}`);
            });

            channel.ack(msg);
        }
        catch (error) {
            console.error('Error processing message: ', error);
        }
        
    }, { noAck: false});

}

main();