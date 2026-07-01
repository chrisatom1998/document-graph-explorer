# Terraform Modules

Every piece of infrastructure at Nimbus Labs — the Kubernetes cluster
itself, the namespaces inside it, the Postgres instances, the Kafka
cluster — is provisioned by a Terraform module living in the `infra-modules`
repo. If you find yourself about to click a button in a cloud console,
stop and write a module instead.

## Why modules instead of one giant root

Early on we had a single Terraform root for everything, and every plan
took four minutes and touched resources three teams cared about. Now each
service owns a small module that composes shared building blocks:

- `module.k8s_service` — Deployment, Service, HPA, and the
  `nimbus.io/service-tier` label described in
  [Kubernetes Conventions](kubernetes-conventions.md).
- `module.postgres_db` — a Postgres schema, role, and connection pool
  configuration (see [Postgres Operations](postgres-operations.md) for how
  pool sizing is chosen).
- `module.kafka_topic` — topic creation with partition count and retention
  set explicitly rather than inheriting cluster defaults; see
  [Kafka Event Bus](kafka-event-bus.md).

## The blue-green primitive

`module.k8s_service` is also what makes blue-green deploys possible: it
provisions the `Service` selector as a variable that CI flips between
`blue` and `green` labels during the rollout described in the
[Deploy Guide](deploy-guide.md). Nobody hand-edits this — the module is the
only writer.

## Review requirements

Any module change that touches IAM roles, secrets access, or network
policy requires a second reviewer from Platform *and* a note in the
[Security Review Process](security-review-process.md) queue if it grants
new access to anything holding customer data. This isn't bureaucracy for
its own sake — see [Secrets Management](secrets-management.md) for what
happens when a Terraform change accidentally widens an IAM policy.

## State and locking

State is stored remotely with locking enabled; two engineers running
`terraform apply` on the same module at the same time is a fast way to
corrupt state, not a race you want to win. If `terraform plan` shows
changes you didn't expect, do not `apply` — that's drift, and drift means
someone (or something) changed infrastructure outside of Terraform. Report
it in `#platform` per the [Architecture Overview](architecture-overview.md)
philosophy of Terraform being the only source of truth.

## Module versioning

Modules are versioned with git tags (`v1.4.0`), and services pin an exact
version rather than tracking `main`. Bumping a module version is a normal
pull request, reviewed like any other change, with the diff of the
underlying resources included for the reviewer.
