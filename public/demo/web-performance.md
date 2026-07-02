We measure our applications using Core Web Vitals to guarantee speed.

## Core Targets
- **Largest Contentful Paint (LCP)**: Under 2.5 seconds.
- **First Input Delay (FID)**: Under 100 milliseconds.
- **Cumulative Layout Shift (CLS)**: Under 0.1.

## Diagnostics
We use Google Lighthouse audits running inside our CI environment. Pull requests that degrade performance scores below 90 will trigger review blocks.
See also:
- [Bundle Size Optimization](bundle-optimization.md)
- [CDN Caching](cdn-caching.md)