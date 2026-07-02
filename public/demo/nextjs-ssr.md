NextJS is utilized for our main dashboard portal. This document details our Server-Side Rendering (SSR) and Static Site Generation (SSG) patterns.

## SSR Caching
Data fetched in `getServerSideProps` must include appropriate cache control headers to leverage CDN edges.

## Hydration Troubleshooting
Hydration errors happen when the server-rendered HTML differs from the client-rendered output. Ensure date/time strings are formatted client-side only or use fixed-zone formatting.
See also:
- [CDN Caching](cdn-caching.md)
- [Web Performance Metrics](web-performance.md)