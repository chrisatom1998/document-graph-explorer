This guide details how to spin up Nimbus Labs codebases on your local machine.

## Prerequisites
Ensure Docker Desktop is installed.
1. Run `docker-compose up -d` to spin up PostgreSQL, Redis, and Kafka.
2. Run `npm run seed` to seed mock data.
3. Run `npm run dev` to launch the server locally.

See also:
- [Postgres Operations](postgres-operations.md)
- [Kafka Event Bus](kafka-event-bus.md)