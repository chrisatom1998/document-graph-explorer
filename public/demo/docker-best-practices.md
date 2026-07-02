We run applications inside containerized environments. This guide details building secure, lightweight Docker images.

## Standards
- **Multi-Stage Builds**: Keep final production images minimal.
- **Base Images**: Use official Alpine Linux base images to minimize security vulnerabilities.
- **Run as non-root**: Never run containers with root privileges.

See also:
- [Vulnerability Scanning](vuln-scanning.md)
- [GitHub Actions](github-actions.md)