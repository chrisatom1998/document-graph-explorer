Modern software heavily relies on open-source packages. We run continuous auditing steps to ensure external packages don't introduce supply-chain vulnerabilities.

## Automated Checkpoints
- **CI Linting**: Warns if dependencies contain license conflicts (e.g., GPL-3.0 in frontend code).
- **Renovate Bot**: Generates PRs weekly to update package versions.
- **Lockfile Verification**: We enforce checksum validations to avoid malicious package swaps.

See also:
- [Vulnerability Scanning](vuln-scanning.md)
- [GitHub Actions](github-actions.md)