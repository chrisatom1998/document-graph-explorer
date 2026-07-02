Security at Nimbus Labs requires continuous checking for vulnerabilities in our code packages, operating system dependencies, and container images.

## Scanning Pipeline
- **GitHub Dependency Graph**: Continuous monitoring of package updates.
- **Trivy**: Runs inside our Docker build pipeline, checking for container base image vulnerabilities.
- **Snyk**: Integrates with pull requests to alert on package CVEs.

## Remediation SLAs
- **Critical CVE**: Patch must be deployed within 48 hours.
- **High CVE**: Patch must be deployed within 14 days.
- **Medium/Low**: Scheduled with sprint cycles.

See also:
- [Deploy Guide](deploy-guide.md)
- [Security Review Process](security-review-process.md)