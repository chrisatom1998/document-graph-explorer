Access control to AWS resources is strictly governed by IAM Policies adhering to the principle of least privilege. We separate roles by environments (production, staging, development).

## Authentication & Roles
Engineers authenticate via SSO. We utilize AWS IAM Identity Center mapped to our Okta directory.
Applications run using IAM Roles for Service Accounts (IRSA), mapping Kubernetes service accounts to specific AWS IAM Roles. This avoids hardcoding keys.

## Audit and Enforcement
IAM policies are regularly audited for wildcard permissions (`*`).
See also:
- [SSO Okta Setup](sso-okta-setup.md)
- [Secrets Management](secrets-management.md)