MFA is mandatory for all employee accounts, corporate systems, and AWS resources. No exceptions are allowed for administrative accounts.

## Approved MFA Methods
- **Hardware Security Keys**: (YubiKey) Mandatory for infrastructure, AWS, and deployment access.
- **Authenticator App**: (Google Authenticator, Okta Verify) Allowed for email and general productivity apps.
- **SMS**: Disallowed as an authentication factor due to SIM-swap risks.

## Recovery Procedures
If a key is lost, recovery requires verbal validation by two executive team members.
See also:
- [SSO Okta Setup](sso-okta-setup.md)
- [Secrets Management](secrets-management.md)