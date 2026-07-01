# Bundled font

**Inter-Regular.woff** — Inter typeface by Rasmus Andersson.
Licensed under the SIL Open Font License, Version 1.1 (`OFL-1.1`).

Source: https://github.com/rsms/inter · https://rsms.me/inter/

This font is vendored locally (rather than fetched from a CDN at runtime) so
that Knowledge Nebula makes **zero external network requests** while rendering,
in keeping with the project's privacy-by-architecture guarantee. troika/drei
`<Text>` loads this file via a same-origin `fetch()`, which the app's
Content-Security-Policy permits (`connect-src 'self'`).

The full OFL-1.1 license text is available at:
https://openfontlicense.org/open-font-license-official-text/
