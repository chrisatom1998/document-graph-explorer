Nimbus Labs utilizes Redis to cache volatile database queries, user sessions, and rate-limiting counters. This caching layer prevents overloading our Postgres database.

## Eviction Policy
Our primary Redis instances are configured with the `allkeys-lru` eviction policy.
- **Session Cache**: Explicit TTLs ranging from 30 minutes to 24 hours.
- **Database Cache**: Short TTLs (1 to 5 minutes) to ensure data doesn't get stale.

## Disaster Recovery
Redis is treated as ephemeral. Do not store critical, non-reconstructible data in Redis.
See also:
- [Postgres Operations](postgres-operations.md)
- [API Rate Limiting](api-rate-limiting.txt)