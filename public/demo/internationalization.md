To reach global markets, our user interfaces support translations. We use `react-i18next`.

## Translating Files
All localized text must be extracted to JSON files under `public/locales/[lang]/translation.json`.
- Never hardcode user strings in React components.
- Wrap dynamic numbers and dates in localizers to format currency and timezones correctly.

See also:
- [NextJS Server Side Rendering](nextjs-ssr.md)
- [Data Retention Policy](data-retention-policy.md)