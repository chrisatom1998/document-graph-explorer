// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../model/types';

vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn() }));
vi.mock('./PdfPreview', () => ({ default: () => <div role="img" aria-label="Page 1" /> }));

import { getOriginal } from '../persistence/originals';
import { textStore } from '../store/runtimeStores';
import SidePanelReader from './SidePanelReader';

const node: DocNode = {
  id: 'pdf-doc', kind: 'document', title: 'Recovery plan', fileType: 'pdf',
  topics: [], entities: [], keywords: [], wordCount: 10, cluster: 0, degree: 0, status: 'ok',
};
const body = 'The disaster recovery procedure is tested quarterly.';

function reader(highlight = false) {
  return <SidePanelReader node={node} nodes={[node]} readerLabel="PDF" codeLang={null}
    readerHighlight={highlight ? { docId: node.id, text: 'disaster recovery procedure', passageIndex: 0 } : null} />;
}

describe('PDF accessible reading view', () => {
  beforeEach(() => {
    textStore.set(node.id, body);
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(getOriginal).mockResolvedValue({
      hash: node.id, blob: new Blob(['pdf']), name: 'plan.pdf',
    });
  });
  afterEach(() => {
    cleanup();
    textStore.clear();
  });

  it('offers native buttons that switch between the PDF image and extracted text', async () => {
    render(reader());
    await screen.findByRole('img', { name: 'Page 1' });
    const textButton = screen.getByRole('button', { name: 'Extracted text' });
    textButton.focus();
    expect(textButton).toHaveFocus();
    fireEvent.click(textButton);
    expect(textButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(body)).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Page 1' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PDF preview' }));
    await screen.findByRole('img', { name: 'Page 1' });
  });

  it('opens retrieved PDF passages in text view and preserves the highlight', async () => {
    const { container, rerender } = render(reader());
    await screen.findByRole('img', { name: 'Page 1' });
    rerender(reader(true));
    expect(screen.getByRole('button', { name: 'Extracted text' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('mark.passage-mark')).toHaveTextContent('disaster recovery procedure');
    expect(screen.queryByRole('img', { name: 'Page 1' })).not.toBeInTheDocument();
  });

  it('keeps extracted text available when original PDF bytes were not retained', async () => {
    vi.mocked(getOriginal).mockResolvedValue(undefined);
    render(reader());
    await waitFor(() => expect(getOriginal).toHaveBeenCalledWith(node.id));
    expect(screen.getByText(body)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'PDF reading view' })).not.toBeInTheDocument();
  });
});
