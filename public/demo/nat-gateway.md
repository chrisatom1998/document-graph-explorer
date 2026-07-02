Network Address Translation (NAT) Gateways enable instances in our private subnets to reach out to the internet (for API integration, package updates, etc.) while blocking inbound connections.

## Configuration
We run one NAT Gateway per availability zone. This avoids cross-AZ traffic charges and prevents a single AZ outage from taking down outbound connectivity for the entire cluster.

## Monitoring Bandwidth
We track NAT Gateway data transfer volume to avoid ballooning cloud costs. High traffic flows should be directed through VPC endpoints where possible.
See also:
- [VPC Configuration](vpc-config.md)
- [Terraform Modules](terraform-modules.md)