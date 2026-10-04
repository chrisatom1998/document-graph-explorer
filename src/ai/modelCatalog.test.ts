import { describe, expect, it } from 'vitest';
import {
  openRouterModelOptions,
  parseModelList,
  RECOMMENDED_CHAT_MODELS,
  RECOMMENDED_ENRICH_MODELS,
} from './modelCatalog';

describe('parseModelList', () => {
  it('extracts and sorts model ids', () => {
    const data = { data: [{ id: 'z/model' }, { id: 'a/model' }] };
    expect(parseModelList(data)).toEqual(['a/model', 'z/model']);
  });

  it('ignores entries without a usable id and never throws on odd shapes', () => {
    expect(parseModelList({ data: [{ id: 42 }, { id: '  ' }, { id: 'ok/x' }] })).toEqual(['ok/x']);
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ data: 'not an array' })).toEqual([]);
  });
});

describe('openRouterModelOptions', () => {
  const curated = RECOMMENDED_ENRICH_MODELS.map((m) => m.id);

  it('offers only fast-tier curated models the catalog actually serves', () => {
    const options = openRouterModelOptions(
      'enrichment',
      [curated[0], curated[1], 'other/model'],
      curated[0],
    );
    expect(options.map((o) => o.id)).toEqual([curated[0], curated[1]]);
    // A model the catalog lists but we did not curate must not leak in — the
    // whole point is that every option is fast enough for whole-corpus runs.
    expect(options.some((o) => o.id === 'other/model')).toBe(false);
  });

  it('falls back to the full curated list when the catalog is unavailable', () => {
    expect(openRouterModelOptions('enrichment', null, curated[0]).map((o) => o.id)).toEqual(
      curated,
    );
  });

  it('keeps a saved model selectable when it is not in the curated list', () => {
    const options = openRouterModelOptions('enrichment', null, 'some/retired-model');
    // Upgrades carry an older selection forward; dropping it would silently
    // switch the user's model out from under them.
    expect(options.at(-1)).toMatchObject({ id: 'some/retired-model' });
  });

  it('does not duplicate the current model when it is already curated', () => {
    const ids = openRouterModelOptions('enrichment', null, curated[1]).map((o) => o.id);
    expect(ids.filter((id) => id === curated[1])).toHaveLength(1);
  });

  it('adds nothing for an empty current selection', () => {
    expect(openRouterModelOptions('enrichment', null, '').map((o) => o.id)).toEqual(curated);
  });

  it('serves a different, quality-first list for chat than for enrichment', () => {
    const chat = openRouterModelOptions('chat', null, '').map((o) => o.id);
    expect(chat).toEqual(RECOMMENDED_CHAT_MODELS.map((m) => m.id));
    expect(chat).not.toEqual(curated);
    // Chat is one request per question, so its default leads with a flagship
    // model; enrichment's leads with a fast one.
    expect(chat[0]).toBe('anthropic/claude-sonnet-5');
    expect(curated[0]).toBe('google/gemini-3.1-flash-lite');
  });

  it('offers Gemini 3.7 Flash for both chat and enrichment', () => {
    const flash = 'google/gemini-3.7-flash';
    expect(RECOMMENDED_CHAT_MODELS.map((m) => m.id)).toContain(flash);
    expect(RECOMMENDED_ENRICH_MODELS.map((m) => m.id)).toContain(flash);
    expect(openRouterModelOptions('chat', null, '').some((o) => o.id === flash)).toBe(true);
    expect(openRouterModelOptions('enrichment', null, '').some((o) => o.id === flash)).toBe(true);
  });

  it('adds newer cheap and flagship options that fill provider gaps', () => {
    const enrich = RECOMMENDED_ENRICH_MODELS.map((m) => m.id);
    const chat = RECOMMENDED_CHAT_MODELS.map((m) => m.id);
    expect(enrich).toEqual(expect.arrayContaining([
      'openai/gpt-5.6-luna',
      'deepseek/deepseek-v4-flash',
      'minimax/minimax-m3',
    ]));
    expect(chat).toEqual(expect.arrayContaining([
      'openai/gpt-5.6-sol',
      'x-ai/grok-4.6',
      'deepseek/deepseek-v4-pro',
      'openai/gpt-5.6-luna',
    ]));
    // Enrichment stays fast-tier: no flagship / pro models.
    expect(enrich).not.toContain('openai/gpt-5.6-sol');
    expect(enrich).not.toContain('x-ai/grok-4.6');
    expect(enrich).not.toContain('deepseek/deepseek-v4-pro');
  });
});
