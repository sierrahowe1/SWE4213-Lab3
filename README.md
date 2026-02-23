# Lab 3: Microservice Communication — Synchronous & Asynchronous

## Overview

In this lab you will build a **hospital appointment booking system** composed of four microservices. The system demonstrates two fundamental communication styles used in real-world microservice architectures:

- **Synchronous communication** via HTTP REST (request/response)
- **Asynchronous communication** via RabbitMQ message queues (fire-and-forget / event-driven)

You will write every service from scratch, containerise each one with a `Dockerfile`, and wire the whole system together with a `docker-compose.yml`.

---

## Learning Objectives

By the end of this lab you will be able to:

1. Explain the difference between synchronous and asynchronous inter-service communication and identify appropriate use cases for each.
2. Build REST APIs that call other services over HTTP.
3. Publish messages to a RabbitMQ exchange from a producer service.
4. Consume messages from a RabbitMQ queue in a worker service.
5. Use manual acknowledgements and prefetch to consume messages reliably.
6. Containerise multiple services and orchestrate them with Docker Compose.

---

## Scenario

A patient contacts a hospital to book an appointment with a doctor. The following must happen:

1. The **Appointment Service** receives the booking request.
2. Before confirming the appointment, it **synchronously** calls the **Doctor Service** to verify the doctor exists and has an available slot, and to reserve that slot.
3. If a slot is available and reserved, the Appointment Service **publishes an event** to a RabbitMQ exchange.
4. Two independent worker services consume that event asynchronously:
   - The **Notification Service** simulates sending a confirmation email to both the patient and the doctor.
   - The **Records Service** logs the appointment to a running patient history.

The patient gets an immediate response telling them whether their booking was confirmed. The notification and records work happens in the background without blocking that response.

---

## Architecture

```
                        ┌──────────────────────┐
         HTTP POST      │                      │
  Client ─────────────► │ Appointment Service  │
         ◄───────────── │     (port 5001)      │
         JSON response  │                      │
                        └──────────┬───────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
           HTTP (synchronous)           AMQP (asynchronous)
                    │                             │
                    ▼                             ▼
         ┌──────────────────┐       ┌──────────────────────┐
         │                  │       │       RabbitMQ       │
         │  Doctor Service  │       │                      │
         │   (port 5002)    │       │  Exchange: "appts"   │
         │                  │       │  (fanout)            │
         └──────────────────┘       │                      │
                                    │  ┌──────────────────┐│
                                    │  │ notifications Q  ││
                                    │  └────────┬─────────┘│
                                    │           │          │
                                    │  ┌────────┴─────────┐│
                                    │  │    records Q     ││
                                    │  └────────┬─────────┘│
                                    └───────────┼──────────┘
                                                │
                             ┌──────────────────┴──────────────────┐
                             │                                      │
                             ▼                                      ▼
               ┌─────────────────────────┐          ┌──────────────────────────┐
               │   Notification Service  │          │      Records Service      │
               │    (queue consumer)     │          │     (queue consumer)      │
               └─────────────────────────┘          └──────────────────────────┘
```

### Communication Summary

| From                 | To                   | Protocol | Style        | Why                                                        |
|----------------------|----------------------|----------|--------------|------------------------------------------------------------|
| Appointment Service  | Doctor Service       | HTTP     | Synchronous  | Booking depends on whether a slot is actually available    |
| Appointment Service  | RabbitMQ exchange    | AMQP     | Asynchronous | Notifications and records do not affect the booking response |
| RabbitMQ             | Notification Service | AMQP     | Asynchronous | Worker consumes at its own pace                            |
| RabbitMQ             | Records Service      | AMQP     | Asynchronous | Worker consumes at its own pace                            |

---

## Repository Structure

You must organise your repository exactly as follows:

```
SWE4213-Lab3/
├── docker-compose.yml
├── appointment-service/
│   ├── Dockerfile
│   └── ...your source files...
├── doctor-service/
│   ├── Dockerfile
│   └── ...your source files...
├── notification-service/
│   ├── Dockerfile
│   └── ...your source files...
└── records-service/
    ├── Dockerfile
    └── ...your source files...
```

You may use any programming language you like. Python, Node.js, and Go are all reasonable choices.

---

## Service Specifications

### 1. Doctor Service

This service manages a roster of doctors and their available appointment slots. It must be running and healthy **before** the Appointment Service tries to contact it, so start here.

**Data model** — maintain an in-memory roster with at least three doctors. Each doctor has:
- A unique ID (e.g. `"D001"`)
- A name
- A specialty
- A number of available slots (integer)

**Endpoints:**

| Method | Path                       | Description                                                              |
|--------|----------------------------|--------------------------------------------------------------------------|
| `GET`  | `/doctors`                 | Returns the full roster with current slot availability.                  |
| `GET`  | `/doctors/<id>`            | Returns details for a single doctor. Returns `404` if not found.         |
| `POST` | `/doctors/<id>/reserve`    | Reserves one appointment slot. See request/response contract below.      |

**`POST /doctors/<id>/reserve` contract:**

Request body:
```json
{ "slots": 1 }
```

Success response (`200`):
```json
{
  "success": true,
  "doctor_id": "D001",
  "doctor_name": "Dr. Sarah Chen",
  "slots_remaining": 4
}
```

Failure response (`409` — no slots available):
```json
{
  "success": false,
  "reason": "Dr. Sarah Chen has no available slots."
}
```

---

### 2. Appointment Service

This is the entry point for patients. It exposes a single endpoint that orchestrates a full appointment booking.

**Endpoints:**

| Method | Path           | Description              |
|--------|----------------|--------------------------|
| `POST` | `/appointments`| Book a new appointment   |

**`POST /appointments` contract:**

Request body:
```json
{
  "patient_name": "James Okafor",
  "patient_email": "james@example.com",
  "doctor_id": "D001",
  "reason": "Annual check-up"
}
```

**Booking logic (implement in this order):**

1. Validate the request body. Return `400` if any required field is missing.
2. Call `POST /doctors/<doctor_id>/reserve` on the Doctor Service (HTTP).
3. If the Doctor Service returns a non-200 response or `success: false`, return `409` to the client with the reason from the Doctor Service.
4. If the reservation succeeds, build an appointment event and publish it to the `appts` RabbitMQ exchange (fanout type). The event must include at minimum:
   - `appointment_id` — a unique identifier you generate (e.g. a UUID)
   - `patient_name`
   - `patient_email`
   - `doctor_id`
   - `doctor_name` (from the Doctor Service response)
   - `reason`
   - `timestamp`
5. Return `201` to the client.

Success response (`201`):
```json
{
  "appointment_id": "a1b2c3d4-...",
  "status": "confirmed",
  "message": "Your appointment with Dr. Sarah Chen has been booked. A confirmation email will be sent shortly."
}
```

Failure response (`409`):
```json
{
  "status": "rejected",
  "reason": "Dr. Sarah Chen has no available slots."
}
```

> **Note on the Doctor Service URL:** read it from an environment variable (e.g. `DOCTOR_SERVICE_URL`) rather than hard-coding `localhost`. Docker Compose will inject this.

---

### 3. Notification Service

This is a **background worker** — it does not expose any HTTP endpoints. It connects to RabbitMQ, binds a queue named `notifications` to the `appts` fanout exchange, and waits for messages.

When a message arrives, print output to stdout that simulates sending a confirmation email, for example:

```
[Notification] Sending confirmation to james@example.com
  Appointment ID : a1b2c3d4-...
  Doctor         : Dr. Sarah Chen
  Reason         : Annual check-up
  Status         : confirmed
```

**Prefetch:** set a prefetch count of `1` on the channel before starting to consume. Without this, RabbitMQ will push every queued message into the consumer's buffer at once. If processing were slow (e.g. a real SMTP call), this could overwhelm the consumer. A prefetch of `1` tells RabbitMQ not to deliver another message until the current one has been acknowledged.

**Acknowledgements:** consume in manual acknowledgement mode. After successfully processing a message, explicitly send an acknowledgement (ack) back to the broker. Do not ack before processing is complete. This ensures that if the service crashes mid-processing, RabbitMQ will re-queue the message and redeliver it rather than silently dropping it.

The service must handle the case where RabbitMQ is not yet ready when it starts. Implement a retry loop with a short sleep between attempts.

---

### 4. Records Service

This is also a **background worker** with no HTTP endpoints. It connects to RabbitMQ, binds a queue named `records` to the same `appts` fanout exchange, and waits for messages.

When a message arrives, add the appointment to an in-memory log and print a running summary, for example:

```
[Records] New appointment logged — total on record: 3
  james@example.com → Dr. Sarah Chen (Annual check-up) at 2024-11-01T10:32:00
  sarah@example.com → Dr. James Ruiz (Follow-up) at 2024-11-01T10:28:00
  ...
```

Keep the log in memory (a list is fine). Apply the same prefetch, manual acknowledgement, and RabbitMQ retry logic as the Notification Service.

---

## RabbitMQ Setup

### Background: Exchanges, Queues, and Bindings

In RabbitMQ, producers never publish messages directly to a queue. Instead they publish to an **exchange**, and the exchange decides which queues receive the message. Queues are connected to an exchange via **bindings**.

```
Producer ──► Exchange ──► (routing logic) ──► Queue A
                                          └──► Queue B
```

RabbitMQ provides several exchange types that implement different routing strategies:

| Exchange Type | Routing behaviour |
|---|---|
| **Fanout** | Ignores the message entirely and delivers a copy to **every** bound queue. |
| **Direct** | Delivers to queues whose binding key exactly matches the message's routing key (e.g. `"urgent"` only goes to the `urgent-appointments` queue). |
| **Topic** | Like direct, but binding keys can include wildcards — `"appt.*"` matches `"appt.confirmed"` and `"appt.cancelled"`. |
| **Headers** | Routes based on message header attributes instead of a routing key. Rarely used. |

### Why This Lab Uses Fanout

Both the Notification Service and the Records Service need to react to **every** appointment event — there is no filtering required. A fanout exchange is the simplest way to achieve this: the Appointment Service publishes one message, and RabbitMQ automatically delivers an independent copy to each bound queue.

```
Appointment Service publishes ONE message to the "appts" exchange
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
  "notifications" queue            "records" queue
          │                               │
          ▼                               ▼
  Notification Service             Records Service
  (processes independently)        (processes independently)
```

Each service gets its own copy and processes it at its own pace. If the Records Service is slow or temporarily crashes, the Notification Service is completely unaffected — the two queues are fully isolated from each other.

This also makes the system easy to extend. If you later added a Billing Service, you would simply bind a new queue to the same `appts` exchange and it would automatically start receiving all appointment events — without changing the Appointment Service at all.

> **Contrast with a single shared queue:** if both services consumed from the same queue, each message would only be delivered to whichever service picked it up first. The other service would never see it.

### Topology to Implement

You do **not** need to write any RabbitMQ broker configuration — the official `rabbitmq:3-management` Docker image is sufficient. However, your producer (Appointment Service) and consumers (Notification, Records) must declare the exchange and queues in code when they start.

| Resource           | Type    | Name            |
|--------------------|---------|-----------------|
| Exchange           | fanout  | `appts`         |
| Queue              | durable | `notifications` |
| Queue              | durable | `records`       |
| Binding (queue 1)  | —       | `notifications` → `appts` |
| Binding (queue 2)  | —       | `records`       → `appts` |

Declaring the exchange and queues is idempotent — it is safe to declare them in both the producer and each consumer. RabbitMQ will simply confirm they already exist on subsequent declarations.

---

## Docker Requirements

### Dockerfiles

Each service directory must contain a `Dockerfile`. Your Dockerfiles must:

- Use an appropriate base image for your chosen language.
- Copy only the files needed to run the service (do not copy unrelated files).
- Install dependencies inside the image (e.g. `pip install`, `npm install`).
- Set a default command that starts the service.
- Not run as root if your base image makes it easy to avoid (use a non-root user where practical).

### docker-compose.yml

The `docker-compose.yml` at the root of the repository must:

1. Define a service for each of the four microservices.
2. Define a `rabbitmq` service using the `rabbitmq:3-management` image.
   - Expose the management UI on port `15672` so you can inspect queues in a browser.
3. Define a `depends_on` relationship so that:
   - `appointment-service` starts after `doctor-service` and `rabbitmq`.
   - `notification-service` and `records-service` start after `rabbitmq`.
4. Pass the Doctor Service URL to `appointment-service` as an environment variable.
5. Pass the RabbitMQ connection details (host, user, password) to the three services that use it as environment variables.
6. Place all four microservices and RabbitMQ on a shared custom Docker network.
7. Expose `appointment-service` on port `5001` and `doctor-service` on port `5002` on the host so you can test them with `curl` or Postman.

> **Tip:** `depends_on` only waits for the container to *start*, not for the service inside it to be *ready*. This is why your RabbitMQ consumers need the retry loop mentioned above.

---

## Running the System

Once your implementation is complete, the following commands should bring everything up:

```bash
docker compose build
docker compose up
```

To stop and remove containers:

```bash
docker compose down
```

---

## Testing Your Implementation

Work through these steps in order to verify everything is working.

### 1. Check the doctor roster

```bash
curl http://localhost:5002/doctors
```

You should see your doctor roster with slot availability.

### 2. Book a valid appointment

```bash
curl -X POST http://localhost:5001/appointments \
     -H "Content-Type: application/json" \
     -d '{
           "patient_name": "James Okafor",
           "patient_email": "james@example.com",
           "doctor_id": "D001",
           "reason": "Annual check-up"
         }'
```

Expected: `201` response with an `appointment_id`.
In the terminal running `docker compose up` you should see log output from both the Notification Service and the Records Service.

### 3. Verify the slot was decremented

```bash
curl http://localhost:5002/doctors/D001
```

The available slots should be one fewer than before.

### 4. Exhaust the slots

Book appointments until a doctor has no slots remaining, then try to book one more with that doctor. You should receive a `409` response, and the consumer logs should stay quiet (no message was published).

### 5. Inspect RabbitMQ

Open `http://localhost:15672` in a browser (default credentials: `guest` / `guest`).
Navigate to **Exchanges** and confirm the `appts` exchange exists.
Navigate to **Queues** and confirm both `notifications` and `records` queues exist and are bound to the exchange.

---

## Deliverables

Submit your repository (as a zip or a link to a GitHub repository) containing:

- [ ] `appointment-service/` with source code and `Dockerfile`
- [ ] `doctor-service/` with source code and `Dockerfile`
- [ ] `notification-service/` with source code and `Dockerfile`
- [ ] `records-service/` with source code and `Dockerfile`
- [ ] `docker-compose.yml`
- [ ] A short `REPORT.md` (one page max) answering the reflection questions below

---

## Reflection Questions (answer in REPORT.md)

1. The Appointment Service waits for the Doctor Service to respond before replying to the patient. What are the implications of this design? What happens to the Appointment Service if the Doctor Service is slow or crashes?

2. The Notification and Records services receive the same message independently via their own queues. What would happen if you used a single shared queue instead of two separate queues bound to a fanout exchange? How would behaviour change?

3. Right now, if the Appointment Service crashes after reserving a slot but *before* publishing the RabbitMQ message, the slot is decremented but no notification or record is created. Describe at least one strategy you could use to address this inconsistency.

4. `depends_on` in Docker Compose does not guarantee that a service is *ready* before dependent services start. How did you handle this in your worker services, and why is this problem inherent to distributed systems?

5. You set `prefetch_count=1` in your consumers. Describe a realistic scenario where a higher prefetch value (e.g. `10`) might be preferable, and one where it could cause problems.

---

## Grading Rubric

| Criteria                                                                    | Marks |
|-----------------------------------------------------------------------------|-------|
| Doctor Service — correct endpoints and slot management                      | 15    |
| Appointment Service — correct HTTP call to Doctor Service                   | 15    |
| Appointment Service — correct RabbitMQ publish on successful reservation    | 15    |
| Notification Service — consumes from queue, manual ack, prefetch            | 10    |
| Records Service — consumes from queue, manual ack, prefetch                 | 10    |
| Correct fanout exchange with two bound queues                               | 10    |
| Dockerfiles — build and run correctly for all four services                 | 10    |
| docker-compose.yml — networking, env vars, port mapping, depends_on         | 10    |
| Reflection questions (REPORT.md)                                            | 5     |
| **Total**                                                                   | **100** |