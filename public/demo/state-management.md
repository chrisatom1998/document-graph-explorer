Choosing the right state management tool prevents unnecessary re-renders and spaghetti code. We use Zustand for global state and React Context for scoped context.

## Zustand Conventions
Create separate store slices for distinct domains (e.g., UI, Chat, Settings).
- Avoid putting large raw datasets (like raw text arrays) directly in state. Keep them in IndexedDB and load them into memory on demand.
- Selectors must be used to pull values from Zustand stores to prevent excessive renders.

See also:
- [UI Design System](ui-design-system.md)
- [CSS Modules](css-modules.md)