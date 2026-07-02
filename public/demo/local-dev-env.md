This guide details how to spin up Nimbus Labs codebases on your local machine.

## Prerequisites
Ensure Docker Desktop is installed. You'll also need Node 20+ and access
to the internal package registry (see [Package Registry](package-registry.md)).

## Setup
1. Run `docker-compose up -d` to spin up PostgreSQL, Redis, and Kafka.
2. Run `npm run seed` to seed mock data.
3. Run `npm run dev` to launch the server locally.

## Common Issues
- **Database won't start**: Check that no other Postgres instance is running on port 5432.
  See [Postgres Operations](postgres-operations.md) for troubleshooting.
- **Kafka consumer lag**: The local Kafka broker can be slow to start.
  See [Kafka Event Bus](kafka-event-bus.md) for broker configuration.
- **Auth errors**: The local auth-service connects to a dev Okta tenant.
  See [Auth Service](auth-service.md) and [SSO Okta Setup](sso-okta-setup.md).
- **Redis connection refused**: Make sure Docker Compose brought up all services.
  See [Redis Cache](redis-cache.md) for cache-layer docs.

## Running Tests
Run `npm test` for unit tests. For end-to-end tests, see
[Playwright Testing](playwright-testing.md). Make sure your local
[Feature Flags](feature-flags.md) match staging.

See also:
- [Docker Best Practices](docker-best-practices.md)
- [Developer Handbook](developer-handbook.md)
- [Monorepo Configuration](monorepo-config.md)