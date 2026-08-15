// @vitest-environment jsdom
/**
 * Disclose used to unmount its children when closed (`{open ? children : null}`),
 * which tore down DocAiSection. Ask AI drafts, answers, and in-flight questions
 * for the same document must survive Hide About → Show About.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';
import { textStore } from '../store/runtimeStores';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';

const askDocAi = vi.hoisted(() => vi.fn());

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));
vi.mock('../enrich/enrichment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../enrich/enrichment')>();
  return { ...actual, askDocAi };
});

import SidePanel from './SidePanel';

function doc(id: string, title: string): DocNode {
  return {
    id,
    kind: 'document',
    title,
    fileType: 'txt',
    topics: [],
    entities: [],
    keywords: [],
    wordCount: 20,
    cluster: 0,
    degree: 0,
    status: 'ok',
  };
}

function openAbout(): void {
  fireEvent.click(screen.getByRole('button', { name: /^about$/i }));
}

function aboutToggle(): HTMLElement {
  return screen.getByRole('button', { name: /^about$/i });
}

describe('SidePanel Ask AI survives About collapse', () => {
  beforeEach(() => {
    askDocAi.mockReset();
    textStore.clear();
    textStore.set('doc1', 'The disaster recovery procedure is tested quarterly.');
    const nodes = [doc('doc1', 'Doc One')];
    useGraphStore.setState({
      nodes,
      nodeIndex: { doc1: 0 },
      edges: [],
      clusterNames: {},
      localClusterNames: {},
    });
    useUiStore.setState({ selectedId: 'doc1', readerHighlight: null, toasts: [] });
    useSettingsStore.setState({ enrichEnabled: true, enrichProvider: 'ollama' });
  });

  afterEach(() => {
    cleanup();
    textStore.clear();
    useUiStore.setState({ selectedId: null, readerHighlight: null });
    useSettingsStore.setState({ enrichEnabled: false, enrichProvider: 'openrouter' });
  });

  it('keeps a typed question when About is collapsed and reopened', () => {
    render(<SidePanel />);
    openAbout();
    fireEvent.change(screen.getByRole('textbox', { name: /ask a question about this document/i }), {
      target: { value: 'What is the recovery cadence?' },
    });

    openAbout();
    expect(aboutToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('textbox', { name: /ask a question about this document/i, hidden: true }),
    ).not.toBeVisible();

    openAbout();
    expect(screen.getByRole('textbox', { name: /ask a question about this document/i })).toHaveValue(
      'What is the recovery cadence?',
    );
  });

  it('keeps a completed Ask AI answer when About is collapsed and reopened', async () => {
    askDocAi.mockResolvedValue({ ok: true, text: 'It is tested quarterly.' });
    render(<SidePanel />);
    openAbout();
    fireEvent.change(screen.getByRole('textbox', { name: /ask a question about this document/i }), {
      target: { value: 'How often is recovery tested?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByText('It is tested quarterly.')).toBeVisible();
    });

    openAbout();
    expect(aboutToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('It is tested quarterly.')).toBeInTheDocument();
    expect(screen.getByText('It is tested quarterly.')).not.toBeVisible();

    openAbout();
    expect(screen.getByText('It is tested quarterly.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: /ask a question about this document/i })).toHaveValue(
      'How often is recovery tested?',
    );
  });

  it('keeps an in-progress Ask AI question when About is collapsed and reopened', async () => {
    let resolveAsk!: (value: { ok: boolean; text: string }) => void;
    askDocAi.mockImplementation(async (_id, _title, _action, _q, onChunk: (text: string) => void) => {
      onChunk('The procedure is tested');
      return new Promise((resolve) => {
        resolveAsk = resolve;
      });
    });

    render(<SidePanel />);
    openAbout();
    fireEvent.change(screen.getByRole('textbox', { name: /ask a question about this document/i }), {
      target: { value: 'How often?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(screen.getByText('The procedure is tested')).toBeVisible();
      expect(screen.getByRole('button', { name: /asking/i })).toBeDisabled();
    });

    openAbout();
    expect(aboutToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('The procedure is tested')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asking/i, hidden: true })).not.toBeVisible();

    openAbout();
    expect(screen.getByText('The procedure is tested')).toBeVisible();
    expect(screen.getByRole('button', { name: /asking/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /asking/i })).toBeDisabled();

    resolveAsk({ ok: true, text: 'Quarterly.' });
    await waitFor(() => {
      expect(screen.getByText('Quarterly.')).toBeVisible();
    });
  });
});
