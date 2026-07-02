This document defines policies for creating, rotating, and revoking API keys used by external customers to access Nimbus Labs products.

## Creation & Storage
API keys are never stored in plain text in our databases. We store a cryptographic hash (SHA-256) of the key. The full key is shown to the user only once upon creation.

## Rotation and Revocation
Customers can configure auto-expiration dates on keys. If an API key is leaked, it must be flagged for immediate revocation via the admin panel.
See also:
- [API Rate Limiting](api-rate-limiting.txt)
- [Auth Service](auth-service.md)