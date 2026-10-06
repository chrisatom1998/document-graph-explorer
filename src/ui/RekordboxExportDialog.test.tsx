// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../persistence/exportImport', () => ({
  dateStamp: () => '2026-10-06',
  downloadBlob: vi.fn(),
}));

import RekordboxExportDialog from './RekordboxExportDialog';
import { downloadBlob } from '../persistence/exportImport';

const track = (path: string): DocNode => ({
  id: path, kind: 'document', title: path.split('/').at(-1)!, fileType: 'audio', path,
  topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  audio: { version: 2, analyzedSeconds: 30, durationSeconds: 200, instruments: [], notes: [], tempo: { bpm: 128, confidence: 1 } },
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(downloadBlob).mockClear();
});

describe('RekordboxExportDialog', () => {
  it('asks for each folder location and downloads the XML', async () => {
    const onClose = vi.fn();
    render(<RekordboxExportDialog nodes={[track('Crate/a.mp3'), track('Crate/b.mp3')]} onClose={onClose} />);
    const exportButton = screen.getByRole('button', { name: 'Export XML' });
    expect(exportButton).toBeDisabled();
    const input = screen.getByLabelText(/Full path of the folder “Crate”/);
    fireEvent.change(input, { target: { value: '/Users/chris/Music' } });
    expect(screen.getByText('Use the full path, ending in /Crate.')).toBeInTheDocument();
    expect(exportButton).toBeDisabled();
    fireEvent.change(input, { target: { value: '/Users/chris/Music/Crate' } });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe('rekordbox-2026-10-06.xml');
    const xml = await (blob as Blob).text();
    expect(xml).toContain('Location="file://localhost/Users/chris/Music/Crate/a.mp3"');
    expect(xml).toContain('AverageBpm="128.00"');
    expect(onClose).toHaveBeenCalled();
    // The folder is remembered for next time.
    cleanup();
    render(<RekordboxExportDialog nodes={[track('Crate/a.mp3')]} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Full path of the folder “Crate”/)).toHaveValue('/Users/chris/Music/Crate');
  });
});
