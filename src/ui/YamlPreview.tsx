/**
 * Lightweight, line-based syntax highlighting for the SidePanel document
 * reader's .yaml documents (`# comments`, `key:` labels, `- ` list markers)
 * — no full YAML parser, just enough visual structure to read comfortably,
 * matching the "show it like the real file" treatment used for the other
 * file types. The raw bytes for this file type ARE the extracted text
 * (verbatim decode, see pipeline/parsers/txt.ts), so this renders directly
 * off the already-cached full text, no async fetch.
 */

import { Fragment, type ReactNode } from 'react';

const KEY_RE = /^(\s*(?:-\s+)?)([\w.$-]+|"[^"]*"|'[^']*')(\s*:)(\s|$)/;
const LIST_MARKER_RE = /^(\s*)(-\s)/;
const COMMENT_RE = /^(\s*)(#.*)$/;

function renderLine(line: string, key: string): ReactNode {
  const commentMatch = COMMENT_RE.exec(line);
  if (commentMatch) {
    return (
      <Fragment key={key}>
        {commentMatch[1]}
        <span className="yaml-comment">{commentMatch[2]}</span>
      </Fragment>
    );
  }

  const keyMatch = KEY_RE.exec(line);
  if (keyMatch) {
    const [full, prefix, keyName, colon, trailing] = keyMatch;
    const rest = line.slice(full.length);
    return (
      <Fragment key={key}>
        {prefix}
        <span className="yaml-key">{keyName}</span>
        {colon}
        {trailing}
        {rest}
      </Fragment>
    );
  }

  const listMatch = LIST_MARKER_RE.exec(line);
  if (listMatch) {
    return (
      <Fragment key={key}>
        {listMatch[1]}
        <span className="yaml-list-marker">{listMatch[2]}</span>
        {line.slice(listMatch[0].length)}
      </Fragment>
    );
  }

  return line;
}

interface YamlPreviewProps {
  text: string;
  className?: string;
}

export default function YamlPreview({ text, className }: YamlPreviewProps) {
  const lines = text.split('\n');
  const wrapClass = className ? `yaml-preview ${className}` : 'yaml-preview';

  return (
    <pre className={wrapClass}>
      <code>
        {lines.map((line, i) => (
          <Fragment key={i}>
            {renderLine(line, `l${i}`)}
            {i < lines.length - 1 ? '\n' : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
