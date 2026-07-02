This runbook guides platform engineers through the step-by-step process of upgrading our AWS Elastic Kubernetes Service (EKS) clusters.

## Preparation
1. Check compatibility of external add-ons (CoreDNS, kube-proxy, AWS VPC CNI).
2. Validate that Helm charts and resource manifests do not use deprecated API versions.
3. Update Terraform variables to specify the new Kubernetes version.

## Upgrade Execution
Apply the control plane upgrade first. Once the control plane is updated, cycle the node groups using a blue-green replacement.
See also:
- [Kubernetes Conventions](kubernetes-conventions.md)
- [Terraform Modules](terraform-modules.md)