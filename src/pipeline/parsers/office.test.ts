import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseOffice } from './office';

async function zipBuffer(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(files)) zip.file(path, text);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('parseOffice', () => {
  it('extracts Word paragraphs, headings, and hyperlinks from docx packages', async () => {
    const bytes = await zipBuffer({
      'word/document.xml': [
        '<w:document xmlns:w="w" xmlns:r="r"><w:body>',
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Security Review</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>See </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>incident runbook</w:t></w:r></w:hyperlink><w:r><w:t> before launch.</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join(''),
      'word/_rels/document.xml.rels': [
        '<Relationships>',
        '<Relationship Id="rId5" Target="incident-runbook.md" />',
        '</Relationships>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'security-review.docx', 'docx');

    expect(parsed.title).toBe('Security Review');
    expect(parsed.headings).toEqual(['Security Review']);
    expect(parsed.text).toContain('See incident runbook before launch.');
    expect(parsed.docLinks).toEqual([{ text: 'incident runbook', url: 'incident-runbook.md' }]);
    expect(parsed.mdLinkTargets).toEqual(['incident-runbook.md']);
  });

  it('uses the Word filename as the docx title when metadata has no title', async () => {
    const bytes = await zipBuffer({
      'word/document.xml': [
        '<w:document xmlns:w="w"><w:body>',
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>The body of the document.</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'customer-onboarding-playbook.docx', 'docx');

    expect(parsed.title).toBe('Customer Onboarding Playbook');
    expect(parsed.headings).toEqual(['Introduction']);
    expect(parsed.text).toContain('The body of the document.');
  });

  it('prefers Word core metadata title over filename when present', async () => {
    const bytes = await zipBuffer({
      'docProps/core.xml': [
        '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc">',
        '<dc:title>Quarterly Security Memo</dc:title>',
        '</cp:coreProperties>',
      ].join(''),
      'word/document.xml': [
        '<w:document xmlns:w="w"><w:body>',
        '<w:p><w:r><w:t>Memo body.</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'draft.docx', 'docx');

    expect(parsed.title).toBe('Quarterly Security Memo');
  });

  it('extracts slide titles, body text, and run hyperlinks from pptx packages', async () => {
    const bytes = await zipBuffer({
      'ppt/slides/slide1.xml': [
        '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>',
        '<a:p><a:r><a:t>Roadmap</a:t></a:r></a:p>',
        '<a:p><a:r><a:rPr><a:hlinkClick r:id="rId2"/></a:rPr><a:t>Q4 plan</a:t></a:r></a:p>',
        '</p:spTree></p:cSld></p:sld>',
      ].join(''),
      'ppt/slides/_rels/slide1.xml.rels': [
        '<Relationships>',
        '<Relationship Id="rId2" Target="https://example.com/q4" TargetMode="External" />',
        '</Relationships>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'roadmap.pptx', 'pptx');

    expect(parsed.title).toBe('Roadmap');
    expect(parsed.headings).toEqual(['Roadmap']);
    expect(parsed.text).toContain('Slide 1: Roadmap');
    expect(parsed.text).toContain('Q4 plan');
    expect(parsed.docLinks).toEqual([{ text: 'Q4 plan', url: 'https://example.com/q4' }]);
  });

  it('uses the PowerPoint filename as the title when metadata has no title', async () => {
    const bytes = await zipBuffer({
      'ppt/slides/slide1.xml': [
        '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>',
        '<a:p><a:r><a:t>Introduction</a:t></a:r></a:p>',
        '<a:p><a:r><a:t>Deck body.</a:t></a:r></a:p>',
        '</p:spTree></p:cSld></p:sld>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'quarterly-business-review.pptx', 'pptx');

    expect(parsed.title).toBe('Quarterly Business Review');
    expect(parsed.headings).toEqual(['Introduction']);
  });

  it('prefers PowerPoint core metadata title over filename when present', async () => {
    const bytes = await zipBuffer({
      'docProps/core.xml': [
        '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc">',
        '<dc:title>Board Roadmap</dc:title>',
        '</cp:coreProperties>',
      ].join(''),
      'ppt/slides/slide1.xml': [
        '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>',
        '<a:p><a:r><a:t>Intro Slide</a:t></a:r></a:p>',
        '</p:spTree></p:cSld></p:sld>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'draft.pptx', 'pptx');

    expect(parsed.title).toBe('Board Roadmap');
  });

  it('extracts worksheet names and shared-string rows from xlsx packages', async () => {
    const bytes = await zipBuffer({
      'xl/workbook.xml': [
        '<workbook xmlns:r="r"><sheets>',
        '<sheet name="Inventory" r:id="rId1" />',
        '</sheets></workbook>',
      ].join(''),
      'xl/_rels/workbook.xml.rels': [
        '<Relationships>',
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml" />',
        '</Relationships>',
      ].join(''),
      'xl/sharedStrings.xml': [
        '<sst>',
        '<si><t>Service</t></si>',
        '<si><t>Owner</t></si>',
        '<si><t>Auth API</t></si>',
        '<si><t>Platform Team</t></si>',
        '</sst>',
      ].join(''),
      'xl/worksheets/sheet1.xml': [
        '<worksheet><sheetData>',
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>',
        '</sheetData></worksheet>',
      ].join(''),
    });

    const parsed = await parseOffice(bytes, 'service-inventory.xlsx', 'xlsx');

    expect(parsed.title).toBe('Service Inventory');
    expect(parsed.headings).toEqual(['Inventory']);
    expect(parsed.text).toContain('Sheet: Inventory');
    expect(parsed.text).toContain('Service | Owner');
    expect(parsed.text).toContain('Auth API | Platform Team');
  });

  it('prefers Excel core metadata title over filename when present', async () => {
    const bytes = await zipBuffer({
      'docProps/core.xml': [
        '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc">',
        '<dc:title>Service Registry</dc:title>',
        '</cp:coreProperties>',
      ].join(''),
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Raw" r:id="rId1" /></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" /></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="inlineStr"><is><t>Value</t></is></c></row></sheetData></worksheet>',
    });

    const parsed = await parseOffice(bytes, 'draft.xlsx', 'xlsx');

    expect(parsed.title).toBe('Service Registry');
    expect(parsed.headings).toEqual(['Raw']);
  });
});
