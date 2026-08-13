import { describe, expect, it } from 'vitest';
import { routeFile, routeFileWithSniff } from './fileRouter';

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
    expect(routeFile('app.ts')).toBe('code');
    expect(routeFile('App.tsx')).toBe('code');
    expect(routeFile('main.py')).toBe('code');
    expect(routeFile('main.go')).toBe('code');
    expect(routeFile('lib.rs')).toBe('code');
    expect(routeFile('Widget.java')).toBe('code');
    expect(routeFile('Dockerfile')).toBe('code');
    expect(routeFile('Makefile')).toBe('code');
    expect(routeFile('CMakeLists.txt')).toBe('code');
    expect(routeFile('go.mod')).toBe('code');
    expect(routeFile('mix.exs')).toBe('code');
    expect(routeFile('Main.hs')).toBe('code');
    expect(routeFile('Page.astro')).toBe('code');
    expect(routeFile('schema.prisma')).toBe('code');
    expect(routeFile('setup.ps1')).toBe('code');
    expect(routeFile('analysis.jl')).toBe('code');
    expect(routeFile('notebook.ipynb')).toBe('json');
    expect(routeFile('notes.rmd')).toBe('md');
    // New extensions
    expect(routeFile('book.epub')).toBe('other');
    expect(routeFile('doc.rtf')).toBe('other');
    expect(routeFile('text.odt')).toBe('other');
    expect(routeFile('sheet.ods')).toBe('other');
    expect(routeFile('pres.odp')).toBe('other');
    expect(routeFile('draw.odg')).toBe('other');
    expect(routeFile('a.markdown')).toBe('md');
    expect(routeFile('a.mdown')).toBe('md');
    expect(routeFile('a.mkd')).toBe('md');
    expect(routeFile('a.mdtext')).toBe('md');
    expect(routeFile('a.mdtxt')).toBe('md');
    expect(routeFile('a.workbook')).toBe('md');
    expect(routeFile('data.tsv')).toBe('csv');
    expect(routeFile('data.psv')).toBe('csv');
    expect(routeFile('data.tab')).toBe('csv');
    expect(routeFile('data.jsonl')).toBe('json');
    expect(routeFile('data.ndjson')).toBe('json');
    expect(routeFile('data.geojson')).toBe('json');
    expect(routeFile('data.jsonld')).toBe('json');
    expect(routeFile('data.xml')).toBe('code');
    expect(routeFile('img.svg')).toBe('html');
    expect(routeFile('page.xhtml')).toBe('html');
    expect(routeFile('page.mhtml')).toBe('html');
    expect(routeFile('page.mht')).toBe('html');
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

  it('returns null for lockfiles and generated bundles even when the extension is known', () => {
    expect(routeFile('package-lock.json')).toBeNull();
    expect(routeFile('yarn.lock')).toBeNull();
    expect(routeFile('pnpm-lock.yaml')).toBeNull();
    expect(routeFile('app.min.js')).toBeNull();
    expect(routeFile('bundle.js.map')).toBeNull();
  });

  it('returns null for files with no extension', () => {
    expect(routeFile('LICENSE')).toBeNull();
    expect(routeFile('CHANGELOG')).toBeNull();
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

describe('routeFileWithSniff', () => {
  it('routes known extensions normally', () => {
    const emptyBytes = new ArrayBuffer(0);
    expect(routeFileWithSniff('notes.txt', emptyBytes)).toBe('txt');
    expect(routeFileWithSniff('report.pdf', emptyBytes)).toBe('pdf');
  });

  it('returns txt for unknown files containing text', () => {
    const textBytes = new TextEncoder().encode('Hello world').buffer;
    expect(routeFileWithSniff('LICENSE', textBytes)).toBe('txt');
    expect(routeFileWithSniff('unknown.ext', textBytes)).toBe('txt');
  });

  it('returns null for unknown files containing binary data', () => {
    const binaryBytes = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0x00]).buffer;
    expect(routeFileWithSniff('unknown.bin', binaryBytes)).toBeNull();
  });

  it('returns null for known binary extensions even if they appear to contain text', () => {
    const textBytes = new TextEncoder().encode('Fake image').buffer;
    expect(routeFileWithSniff('image.png', textBytes)).toBeNull();
    expect(routeFileWithSniff('data.zip', textBytes)).toBeNull();
  });
});
