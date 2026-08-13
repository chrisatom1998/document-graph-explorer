import { cleanFilename, decodeText, type ParserResult } from './txt';

export function parseIpynb(bytes: ArrayBuffer, name: string): ParserResult {
  try {
    const text = decodeText(bytes);
    const notebook = JSON.parse(text);
    
    const headings: string[] = [];
    const textParts: string[] = [];
    
    let title = cleanFilename(name);
    if (notebook.metadata?.title) {
      title = notebook.metadata.title;
    }

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      return {
        title,
        text: '',
        headings: [],
        mdLinkTargets: [],
        docLinks: [],
        status: 'ok',
      };
    }

    let firstHeadingFound = false;

    for (const cell of notebook.cells) {
      if (!cell.cell_type) continue;
      
      const sourceRaw = cell.source || [];
      const sourceText = Array.isArray(sourceRaw) ? sourceRaw.join('') : sourceRaw;
      
      if (cell.cell_type === 'markdown') {
        textParts.push(sourceText);
        // Extract headings
        const lines = sourceText.split('\n');
        for (const line of lines) {
          const match = line.match(/^(#{1,6})\s+(.+)$/);
          if (match) {
            const headingText = match[2].trim();
            headings.push(headingText);
            if (!firstHeadingFound && !notebook.metadata?.title) {
              title = headingText;
              firstHeadingFound = true;
            }
          }
        }
      } else if (cell.cell_type === 'code') {
        const executionCount = cell.execution_count !== undefined && cell.execution_count !== null ? cell.execution_count : ' ';
        textParts.push(`[In ${executionCount}]:\n${sourceText}`);
        
        // Extract python imports, classes, functions for headings
        const lines = sourceText.split('\n');
        for (const line of lines) {
          if (line.match(/^(import|from)\s+/)) {
            headings.push(line.trim());
          } else if (line.match(/^(class|def)\s+([a-zA-Z0-9_]+)/)) {
            const match = line.match(/^(class|def)\s+([a-zA-Z0-9_]+)/);
            if (match) {
              headings.push(match[2]);
            }
          }
        }
        
        // Outputs
        if (Array.isArray(cell.outputs)) {
          for (const output of cell.outputs) {
            if (output.text) {
              const outText = Array.isArray(output.text) ? output.text.join('') : output.text;
              textParts.push(outText);
            }
            if (output.data && output.data['text/plain']) {
              const outText = Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : output.data['text/plain'];
              textParts.push(outText);
            }
            // skip base64 binary like image/png
          }
        }
      } else if (cell.cell_type === 'raw') {
        textParts.push(sourceText);
      }
    }

    return {
      title,
      text: textParts.join('\n\n').trim(),
      headings,
      mdLinkTargets: [],
      docLinks: [],
      status: 'ok',
    };
  } catch (err) {
    return {
      title: cleanFilename(name),
      text: '',
      headings: [],
      mdLinkTargets: [],
      docLinks: [],
      status: 'unreadable',
      warning: err instanceof Error ? err.message : 'Invalid JSON',
    };
  }
}
