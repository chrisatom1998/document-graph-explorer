// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CrateBuilder from './CrateBuilder';
import { EMPTY_SAMPLE_QUERY } from '../audio/sampleQuery';
import type { DocNode } from '../model/types';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('proposes actual local matches, supports replacement, and adds only on request', async () => {
  const audio = ['a', 'b'].map(id => ({ id, title: id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok' }) as DocNode);
  const fetch = vi.fn(async () => Response.json({ plan: { groups: [{ role: 'test', count: 1, query: EMPTY_SAMPLE_QUERY }], clarification: null } }));
  vi.stubGlobal('fetch', fetch);
  const onAdd = vi.fn();
  render(<CrateBuilder audio={audio} localApi ready reference="" onAdd={onAdd} />);
  fireEvent.click(screen.getByText('Build a crate with AI'));
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a crate' }));
  expect(await screen.findByText('test: a')).toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Replace least certain match' }));
  expect(screen.getByText('test: b')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add proposed sounds to crate' }));
  expect(onAdd).toHaveBeenCalledWith(['b']);
  expect(fetch).toHaveBeenCalledOnce();
});
