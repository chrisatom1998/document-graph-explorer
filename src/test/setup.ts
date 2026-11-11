import { afterEach } from 'vitest';

// Only DOM (jsdom) test files need Testing Library. Importing it lazily keeps
// React and react-dom out of the ~270 node-environment test files, where the
// cleanup hook was a no-op anyway.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}
