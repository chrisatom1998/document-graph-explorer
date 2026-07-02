Our EKS worker nodes run on EC2 Autoscaling Groups (ASG). We configure horizontal pod autoscaling (HPA) and cluster autoscaling to dynamically adjust compute capacity.

## Scaling Triggers
- **HPA**: Adds pods when CPU usage averages >75% for a deployment.
- **Cluster Autoscaler**: Deploys new EC2 instances when pods are stuck in "Pending" status due to resource constraints.

## Cool-down Policies
To prevent rapid thrashing, we set scale-in cooldowns to 10 minutes.
See also:
- [Kubernetes Conventions](kubernetes-conventions.md)
- [VPC Configuration](vpc-config.md)