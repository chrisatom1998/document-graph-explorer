Nimbus Labs maintains a SOC 2 Type II certification covering Security, Availability, and Confidentiality. This guide outlines standard controls engineers must follow.

## Core Controls
- **Access Control**: Users must use Okta SSO with MFA.
- **Code Reviews**: Every commit must undergo PR review.
- **Change Management**: Releases must be logged.
- **Encryption**: Data must be encrypted in transit (TLS) and at rest (KMS).

## Evidence Collection
Our compliance platform automatically gathers logs and configurations to verify controls are operational.
See also:
- [SSO Okta Setup](sso-okta-setup.md)
- [Secrets Management](secrets-management.md)