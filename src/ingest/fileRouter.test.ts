import { describe, expect, it } from 'vitest';
import { routeFile } from './fileRouter';

describe('routeFile', () => {
  it('routes every supported extension to its FileType', () => {
    expect(routeFile('notes.txt')).toBe('txt');
    expect(routeFile('server.log')).toBe('txt');
    expect(routeFile('README.md')).toBe('md');
    expect(routeFile('README.mdx')).toBe('md');
    expect(routeFile('report.pdf')).toBe('pdf');
    expect(routeFile('page.html')).toBe('html');
    expect(routeFile('page.htm')).toBe('html');
    expect(routeFile('data.json')).toBe('json');
    expect(routeFile('config.yaml')).toBe('yaml');
    expect(routeFile('config.yml')).toBe('yaml');
    expect(routeFile('table.csv')).toBe('csv');
    expect(routeFile('memo.docx')).toBe('docx');
    expect(routeFile('memo.docm')).toBe('docx');
    expect(routeFile('deck.pptx')).toBe('pptx');
    expect(routeFile('deck.pptm')).toBe('pptx');
    expect(routeFile('sheet.xlsx')).toBe('xlsx');
    expect(routeFile('sheet.xlsm')).toBe('xlsx');
  });

  it('is case-insensitive on the extension', () => {
    expect(routeFile('REPORT.PDF')).toBe('pdf');
    expect(routeFile('Notes.TXT')).toBe('txt');
  });

  it('returns null for unrecognized extensions', () => {
    expect(routeFile('archive.zip')).toBeNull();
    expect(routeFile('image.png')).toBeNull();
    expect(routeFile('binary.exe')).toBeNull();
  });

  it('returns null for files with no extension', () => {
    expect(routeFile('Makefile')).toBeNull();
    expect(routeFile('LICENSE')).toBeNull();
  });

  it('returns null for dotfiles (leading dot, no real extension)', () => {
    expect(routeFile('.gitignore')).toBeNull();
    expect(routeFile('.env')).toBeNull();
  });

  it('returns null for a trailing dot with no extension text', () => {
    expect(routeFile('notes.')).toBeNull();
  });

  it('routes a dotfile WITH a real trailing extension by that extension', () => {
    expect(routeFile('.hidden.md')).toBe('md');
  });

  it('uses only the final extension for multi-dot filenames', () => {
    expect(routeFile('archive.tar.gz')).toBeNull(); // 'gz' isn't a routed extension
    expect(routeFile('report.v2.pdf')).toBe('pdf');
  });
});
