/**
 * Chat empty-state starters built from live graph/insights state instead of
 * generic prompts. Same chip row in ChatPanel; better first message.
 */

export interface ChatStarter {
  label: string;
  prompt: string;
}

const GENERIC_STARTERS: readonly ChatStarter[] = [
  {
    label: 'Compare documents',
    prompt: 'Compare the main positions and evidence across these documents.',
  },
  {
    label: 'Find contradictions',
    prompt: 'Identify contradictions or unresolved disagreements in this corpus, with citations.',
  },
  {
    label: 'Build a timeline',
    prompt: 'Build a timeline of key events, decisions, and dates with citations.',
  },
  {
    label: 'Decisions & actions',
    prompt: 'Extract decisions, owners, and action items from these documents with citations.',
  },
];

export interface ChatStarterContext {
  orphanCount: number;
  largestClusterName?: string;
  pathTitles?: readonly [string, string];
}

export function corpusChatStarters(ctx: ChatStarterContext): ChatStarter[] {
  const out: ChatStarter[] = [];
  if (ctx.orphanCount > 0) {
    out.push(
      ctx.orphanCount === 1
        ? {
            label: 'Why is this orphan isolated?',
            prompt:
              'Why is this orphaned document isolated from the rest of the corpus? What would need to change for it to connect?',
          }
        : {
            label: `Why are these ${ctx.orphanCount} orphans isolated?`,
            prompt: `Why are these ${ctx.orphanCount} orphaned documents isolated from the rest of the corpus? What would need to change for them to connect?`,
          },
    );
  }
  if (ctx.largestClusterName) {
    out.push({
      label: `Summarize ${ctx.largestClusterName}`,
      prompt: `Summarize the largest cluster (${ctx.largestClusterName}): what binds those documents together, and what is the cluster about?`,
    });
  }
  if (ctx.pathTitles) {
    const [a, b] = ctx.pathTitles;
    out.push({
      label: 'Explain this path',
      prompt: `Explain the path between "${a}" and "${b}". What connects them hop by hop?`,
    });
  }
  for (const starter of GENERIC_STARTERS) {
    if (out.length >= 4) break;
    if (out.some((s) => s.label === starter.label)) continue;
    out.push(starter);
  }
  return out.slice(0, 4);
}
