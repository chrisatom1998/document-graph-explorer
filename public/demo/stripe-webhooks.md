Stripe communicates transaction results using webhooks. This document outlines handling webhook reliability.

## Reliability and Idempotency
Stripe may retry webhooks. We guarantee idempotency:
- Every event has a unique Stripe event ID.
- We store processed event IDs in our database and reject duplicates.
- We validate signatures using Stripe SDK secret keys.

See also:
- [Stripe Payment Integration](stripe-integration.md)
- [Secrets Management](secrets-management.md)