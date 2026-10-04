import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseEpub } from './epub';

function createEpubZip(
  containerXml: string | null,
  opfXml: string | null,
  chapters: Record<string, string>,
): ArrayBuffer {
  const zip = new JSZip();
  if (containerXml !== null) {
    zip.file('META-INF/container.xml', containerXml);
  }
  if (opfXml !== null) {
    zip.file('content.opf', opfXml);
  }
  for (const [path, content] of Object.entries(chapters)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'arraybuffer' }) as unknown as ArrayBuffer;
}

const VALID_CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const VALID_OPF = `<?xml version="1.0"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
  </metadata>
  <manifest>
    <item id="chapter1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>`;

describe('parseEpub', () => {
  it.each(['00123', 'true', 'false'])('preserves literal metadata title %s', async (title) => {
    const bytes = await createEpubZip(VALID_CONTAINER, VALID_OPF.replace('Test Book', title), {
      'chap1.xhtml': '<p>Readable chapter</p>',
    });
    expect((await parseEpub(bytes, 'book.epub')).title).toBe(title);
  });

  it('parses basic epub with chapters', async () => {
    const zipData = await createEpubZip(VALID_CONTAINER, VALID_OPF, {
      'chap1.xhtml': '<html><body><h1>Chapter 1</h1><p>Text 1</p></body></html>',
      'chap2.xhtml': '<html><body><h2>Chapter 2</h2><p>Text 2</p></body></html>',
    });

    const result = await parseEpub(zipData, 'test.epub');
    
    expect(result.status).toBe('ok');
    expect(result.title).toBe('Test Book');
    expect(result.headings).toEqual(['Chapter 1', 'Chapter 2']);
    expect(result.text).toContain('Chapter 1\n\nText 1');
    expect(result.text).toContain('Chapter 2\n\nText 2');
  });

  it('handles missing META-INF/container.xml', async () => {
    const zipData = await createEpubZip(null, VALID_OPF, {});
    const result = await parseEpub(zipData, 'test.epub');
    expect(result.status).toBe('unreadable');
    expect(result.warning).toContain('Missing META-INF/container.xml');
  });

  it('handles missing OPF file', async () => {
    const zipData = await createEpubZip(VALID_CONTAINER, null, {});
    const result = await parseEpub(zipData, 'test.epub');
    expect(result.status).toBe('unreadable');
    expect(result.warning).toContain('Missing OPF file');
  });

  it('handles invalid zip', async () => {
    const badBytes = new TextEncoder().encode('not a zip').buffer;
    const result = await parseEpub(badBytes, 'test.epub');
    expect(result.status).toBe('unreadable');
  });
});
