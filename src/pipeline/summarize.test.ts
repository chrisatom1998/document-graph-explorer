import { describe, expect, it } from 'vitest';
import { SUMMARY_MAX_CHARS, SUMMARY_SENTENCES } from '../config';
import { splitSentences, summarize } from './summarize';

describe('splitSentences', () => {
  it('returns [] for empty or whitespace-only input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n\t  ')).toEqual([]);
  });

  it('splits on ., ! and ? into separate sentences', () => {
    expect(
      splitSentences(
        'This is the first sentence of the document. Does it also handle question marks properly? Exclamations work as well, obviously!',
      ),
    ).toEqual([
      'This is the first sentence of the document.',
      'Does it also handle question marks properly?',
      'Exclamations work as well, obviously!',
    ]);
  });

  it('keeps closing quotes and parens attached to their sentence', () => {
    expect(
      splitSentences(
        'She said "Stop that now, please!" and the room fell quiet afterwards. (This was expected by almost everyone.)',
      ),
    ).toEqual([
      'She said "Stop that now, please!"',
      'and the room fell quiet afterwards.',
      '(This was expected by almost everyone.)',
    ]);
  });

  it('treats hard newlines as sentence boundaries even without punctuation', () => {
    expect(
      splitSentences(
        'A heading line without punctuation whatsoever\nThe body paragraph continues on the next line here.',
      ),
    ).toEqual([
      'A heading line without punctuation whatsoever',
      'The body paragraph continues on the next line here.',
    ]);
  });

  it('merges short fragments forward — the chosen behavior heals abbreviation splits like "e.g."', () => {
    // "See e.g." is split off by the period heuristic, but at 8 chars it is
    // below the fragment floor and glues back onto its continuation.
    expect(
      splitSentences(
        'Consider the documentation. See e.g. the appendix section for all details.',
      ),
    ).toEqual([
      'Consider the documentation.',
      'See e.g. the appendix section for all details.',
    ]);
  });

  it('folds a short trailing fragment into the previous sentence', () => {
    expect(
      splitSentences('This opening sentence is comfortably long enough. The end.'),
    ).toEqual(['This opening sentence is comfortably long enough. The end.']);
  });

  it('caps a runaway sentence at 400 characters', () => {
    const runOn = `${'word '.repeat(120).trim()}.`; // ~600 chars, one period
    const sentences = splitSentences(runOn);
    expect(sentences).toHaveLength(1);
    expect(sentences[0].length).toBe(400);
  });
});

describe('summarize', () => {
  it("returns '' when nothing usable", () => {
    expect(summarize('')).toBe('');
    expect(summarize('   \n  ')).toBe('');
  });

  it('returns a single sentence unchanged', () => {
    const sentence = 'Just one single sentence long enough to stand alone.';
    expect(summarize(sentence)).toBe(sentence);
  });

  it('is deterministic', () => {
    const text = Array.from(
      { length: 12 },
      (_, i) =>
        `Sentence number ${i} talks about graph pipelines, embeddings and cluster analysis.`,
    ).join(' ');
    expect(summarize(text)).toBe(summarize(text));
  });

  it('keeps at most SUMMARY_SENTENCES sentences, re-sorted into document order', () => {
    const sentences = [
      'The mission overview describes the launch window and the orbital insertion baseline.',
      'Budget allocation for the mission remained a contested subject at every review.',
      'Thermal analysis of the mission payload identified the launch fairing as the risk.',
      'Cafeteria menus were updated on Tuesday without any warning at all for the staff.',
      'The mission timeline places orbital checkout two weeks after the launch itself.',
      'A stray paragraph about parking permits interrupts the mission narrative here.',
      'Launch rehearsal for the mission validated the orbital telemetry chain end to end.',
      'Weather constraints on the launch window were folded into the mission plan.',
    ];
    const output = summarize(sentences.join(' '));

    // Reconstruct which input sentences were chosen; the output must be
    // exactly those sentences, in original document order.
    const chosen = sentences.filter((s) => output.includes(s));
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.length).toBeLessThanOrEqual(SUMMARY_SENTENCES);
    expect(output).toBe(chosen.join(' '));
  });

  it('survives all-identical sentences and picks the first N', () => {
    const sentence = 'The quarterly revenue report shows strong growth this year.';
    const output = summarize(Array.from({ length: 10 }, () => sentence).join(' '));
    expect(output).toBe(Array.from({ length: SUMMARY_SENTENCES }, () => sentence).join(' '));
  });

  it('considers only the first 300 sentences of a 1000-sentence input, quickly', () => {
    const considered = Array.from(
      { length: 300 },
      (_, i) => `Alpha topic sentence number ${i} covers shared alpha concepts today.`,
    );
    // If these were considered, their mutual similarity of 1 would dominate
    // the ranking — their absence proves the input cap.
    const ignored = Array.from(
      { length: 700 },
      () => 'Beta beta repetition sentence dominates similarity ranking easily.',
    );
    const started = Date.now();
    const output = summarize([...considered, ...ignored].join(' '));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('Alpha');
    expect(output).not.toContain('Beta');
  });

  it('truncates at SUMMARY_MAX_CHARS on a word boundary', () => {
    const sentence = `${'word '.repeat(49).trim()}.`; // 245 chars each
    const joined = [sentence, sentence, sentence].join(' '); // 737 chars, ≤N sentences
    const output = summarize(joined);

    expect(output.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(output.endsWith('…')).toBe(true);
    const body = output.slice(0, -1);
    expect(joined.startsWith(body)).toBe(true);
    expect(joined[body.length]).toBe(' '); // cut fell on a word boundary
  });
});
