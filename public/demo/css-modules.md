To prevent styles from bleeding across components, Nimbus Labs uses CSS Modules.

## Naming Conventions
Files must be named `[Component].module.css`.
- Use camelCase for class names (e.g., `.chatPanelContainer`).
- Reference HSL design system tokens at the root layer for consistent branding colors.

## Avoid Inline CSS
Avoid using inline styles in React elements, as it prevents CSS reuse and slows rendering.
See also:
- [UI Design System](ui-design-system.md)
- [Component Library](component-library.md)