const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672';

async function main() {
    const connection = await amqp.connect(RABBITMQ_URL || "amqp://localhost");
    const channel = await connection.createChannel();
    await channel.assertQueue('notifications', { durable: false});

    await channel.prefetch(1);

    await channel.assertExchange('appts', 'fanout', { durable: false});
    await channel.bindQueue('notifications', 'appts', '');

    channel.consume('notifications', (msg) => {
        try{
            const msgContent = msg.content.toString();
            const appointmentData = JSON.parse(msgContent);

            console.log(`[Notification Service] Sending confirmation to ${appointmentData.patient_email}`);
            console.log(`                       Appointment ID: ${appointmentData.id}`);
            console.log(`                       Doctor: ${appointmentData.doctor_name}`);
            console.log(`                       Reason: ${appointmentData.reason}`);
            console.log(`                       Status: confirmed`);

            channel.ack(msg);
        }
        catch (error) {
            console.error('Error processing message:', error);
        }

    }, { noAck: false});

}

main();