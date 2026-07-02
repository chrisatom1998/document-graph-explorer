DNS management at Nimbus Labs is managed entirely through AWS Route53. We support both public domains (e.g., nimbuslabs.com) and private hosted zones for service resolution within our VPC.

## Public Domains
External routing maps public subnets to Application Load Balancers via Route53 alias records. Direct IP mapping (A records) is discouraged due to IP rotation on load balancers.

## Private Namespaces
Internal service routing uses the `.local` namespace. The core DNS resolver is managed by CoreDNS running on our Kubernetes clusters.
See also:
- [VPC Configuration](vpc-config.md) for subnets.
- [Kubernetes Conventions](kubernetes-conventions.md) for internal service names.