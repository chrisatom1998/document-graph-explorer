import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
