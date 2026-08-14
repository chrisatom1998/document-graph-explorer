import { useEffect, useRef, type ReactNode } from 'react';
import { unwrapPassageMarks, wrapPassageInElement, scrollPassageIntoView } from './passageHighlight';

/**
 * Wraps reader DOM (markdown, HTML, CSV, JSON, YAML) and marks the first
 * retrieved passage so a search/chat citation can scroll to it.
 */
export default function PassageTarget({
  needle,
  contentKey,
  children,
}: {
  needle?: string | null;
  /** Changes when async original bytes replace extracted text. */
  contentKey: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    unwrapPassageMarks(root);
    if (!needle) return;
    const mark = wrapPassageInElement(root, needle);
    scrollPassageIntoView(mark);
    return () => unwrapPassageMarks(root);
  }, [needle, contentKey]);

  return <div ref={ref}>{children}</div>;
}
