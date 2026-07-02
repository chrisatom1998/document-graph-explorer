This document outlines the Virtual Private Cloud (VPC) network architecture for Nimbus Labs. We run our cloud workloads within a secure, multi-AZ VPC to ensure high availability and isolation of network traffic.

## Subnet Architecture
The VPC is partitioned into three distinct subnets across three availability zones (us-east-1a, us-east-1b, us-east-1c):
- **Public Subnets**: Fronted by an internet gateway. Hosts our external load balancers and NAT gateways.
- **Private Subnets**: Hosts EKS worker nodes, ECS tasks, and application containers. Outbound traffic goes through NAT gateways.
- **Database/Isolated Subnets**: Hosts PostgreSQL and Redis. No external ingress or egress path is permitted.

## Routing and Security Groups
Security groups act as stateful firewalls. Any ingress to private subnets must originate from the Application Load Balancer security group.
See also:
- [Kubernetes Conventions](kubernetes-conventions.md) for ingress routing.
- [Terraform Modules](terraform-modules.md) for how subnets are provisioned.