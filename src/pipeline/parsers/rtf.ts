import { cleanFilename, decodeText, type ParserResult } from './txt';

export function parseRtf(bytes: ArrayBuffer, name: string): ParserResult {
  const text = decodeText(bytes);
  
  let i = 0;
  let level = 0;
  let skipLevel = -1;
  const parts: string[] = [];
  
  while (i < text.length) {
    const c = text[i];
    
    if (c === '{') {
      level++;
      i++;
    } else if (c === '}') {
      if (skipLevel !== -1 && level === skipLevel) {
        skipLevel = -1;
      }
      level--;
      i++;
    } else if (c === '\\') {
      i++;
      if (i >= text.length) break;
      const nextC = text[i];
      
      if (nextC === '{' || nextC === '}' || nextC === '\\') {
        if (skipLevel === -1) parts.push(nextC);
        i++;
      } else if (nextC === "'") {
        i++;
        if (i + 1 < text.length) {
          const hex = text.substring(i, i + 2);
          if (skipLevel === -1) {
            parts.push(String.fromCharCode(parseInt(hex, 16)));
          }
          i += 2;
        }
      } else if (nextC === '*') {
        if (skipLevel === -1) {
          skipLevel = level;
        }
        i++;
      } else {
        let word = '';
        while (i < text.length && /[a-zA-Z]/.test(text[i])) {
          word += text[i];
          i++;
        }
        let hasParam = false;
        let param = '';
        if (i < text.length && text[i] === '-') {
          hasParam = true;
          param += '-';
          i++;
        }
        while (i < text.length && /[0-9]/.test(text[i])) {
          hasParam = true;
          param += text[i];
          i++;
        }
        
        if (i < text.length && text[i] === ' ') {
          i++;
        }

        if (word === 'u' && hasParam) {
          if (skipLevel === -1) {
            let code = parseInt(param, 10);
            if (code < 0) code += 65536;
            parts.push(String.fromCharCode(code));
          }
          // The fallback is the next character. We skip 1 char.
          // Wait, if it's \'hh, it might be 4 chars.
          // Let's just skip 1 char (or 1 control word if we wanted to be perfectly compliant, but the requirement says `? is ANSI fallback character`, implying 1 char).
          if (i < text.length) {
             // If the fallback is a hex escape like \'3f
             if (text[i] === '\\' && text[i+1] === "'") {
               i += 4;
             } else {
               i++;
             }
          }
        } else if (skipLevel === -1) {
          if (word === 'par' || word === 'line') {
            parts.push('\n');
          } else if (word === 'tab') {
            parts.push('\t');
          } else if (word === 'fonttbl' || word === 'colortbl' || word === 'stylesheet' || word === 'info') {
            skipLevel = level;
          }
        }
      }
    } else {
      if (skipLevel === -1) {
        if (c !== '\r' && c !== '\n') {
          parts.push(c);
        }
      }
      i++;
    }
  }

  // Cleanup spaces and newlines
  let resultText = parts.join('');
  // Replace multiple spaces with a single space (preserving tabs and newlines)
  resultText = resultText.replace(/[ \f\v]+/g, ' ');
  // Clean up empty lines
  resultText = resultText
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title: cleanFilename(name),
    text: resultText,
    headings: [],
    mdLinkTargets: [],
    docLinks: [],
    status: 'ok',
  };
}
