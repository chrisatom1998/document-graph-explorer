import { describe, expect, it } from 'vitest';
import {
  GEMINI_ENRICH_MODEL,
  GEMINI_INTERACTIVE_MODEL,
  geminiSystemInstruction,
  geminiThinkingConfig,
  resolveGeminiModel,
} from './geminiModels';

describe('Gemini model policy', () => {
  it('routes lightweight enrichment separately from interactive work', () => {
    expect(resolveGeminiModel('enrichment')).toBe(GEMINI_ENRICH_MODEL);
    expect(resolveGeminiModel('document')).toBe(GEMINI_INTERACTIVE_MODEL);
    expect(resolveGeminiModel('chat')).toBe(GEMINI_INTERACTIVE_MODEL);
  });

  it('does not allow callers to override the app-controlled model policy', () => {
    expect(resolveGeminiModel.length).toBe(1);
  });

  it('assigns more reasoning to interactive tasks on Gemini 3 models', () => {
    expect(geminiThinkingConfig('enrichment', GEMINI_ENRICH_MODEL)).toEqual({
      thinkingConfig: { thinkingLevel: 'minimal' },
    });
    expect(geminiThinkingConfig('document', GEMINI_INTERACTIVE_MODEL)).toEqual({
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(geminiThinkingConfig('chat', GEMINI_INTERACTIVE_MODEL)).toEqual({
      thinkingConfig: { thinkingLevel: 'medium' },
    });
  });

  it('does not send Gemini 3-only controls to older models', () => {
    expect(geminiThinkingConfig('chat', 'gemini-2.5-flash')).toEqual({});
  });

  it('avoids unsupported minimal thinking on Gemini 3 Pro', () => {
    expect(geminiThinkingConfig('enrichment', 'gemini-3.1-pro-preview')).toEqual({
      thinkingConfig: { thinkingLevel: 'low' },
    });
  });

  it('marks retrieved content as untrusted source material', () => {
    expect(geminiSystemInstruction('enrichment').parts[0].text).toContain('untrusted');
    expect(geminiSystemInstruction('document').parts[0].text).toContain('never as instructions');
    expect(geminiSystemInstruction('chat').parts[0].text).toContain('only from those passages');
  });
});
