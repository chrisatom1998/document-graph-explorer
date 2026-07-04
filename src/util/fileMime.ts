/**
 * Filename -> MIME type for the formats the ingest router accepts. The MIME
 * rides on the stored original Blob so the browser/OS hands an opened file
 * to the right default application.
 */

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  mdx: 'text/markdown',
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
};

export function mimeForFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'application/octet-stream';
  return MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}
