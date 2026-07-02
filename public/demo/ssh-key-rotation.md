Nimbus Labs enforces strict policies on SSH access to production instances. Direct SSH access over the public internet is blocked.

## Bastion Hosts
All SSH sessions must tunnel through a secure Bastion Host running in our public subnet.
- Bastion hosts require SSH certificate authentication.
- Private keys must be password-protected.

## SSH Key Lifetimes
We rotate host keys and SSH certificates every 30 days using automated configurations.
See also:
- [VPC Configuration](vpc-config.md)
- [AWS IAM Policies](aws-iam-policies.md)