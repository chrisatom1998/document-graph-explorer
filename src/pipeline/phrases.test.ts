import { describe, expect, it } from "vitest";
import { PHRASE_MAX_WORDS, PHRASE_MIN_TF, PHRASE_TOP_PER_DOC } from "../config";
import { extractPhraseTf } from "./phrases";

describe("extractPhraseTf", () => {
  it("returns {} for empty or whitespace-only input", () => {
    expect(extractPhraseTf("")).toEqual({});
    expect(extractPhraseTf("   \n\t  ")).toEqual({});
  });

  it("extracts rate limiting from repeated usage", () => {
    const text = [
      "We implemented rate limiting at the edge.",
      "Rate limiting dropped abusive clients.",
      "Without rate limiting the service collapsed.",
    ].join(" ");
    const tf = extractPhraseTf(text);
    expect(tf["rate limiting"]).toBe(3);
    expect(tf["rate limiting"]!).toBeGreaterThanOrEqual(PHRASE_MIN_TF);
  });

  it("does not emit n-grams that span stopwords (state of the art)", () => {
    const text = "state of the art models beat the state of the art baseline.";
    const tf = extractPhraseTf(text);
    expect(tf["state of the"]).toBeUndefined();
    expect(tf["of the art"]).toBeUndefined();
    expect(tf["state of the art"]).toBeUndefined();
    expect(tf["state art"]).toBeUndefined();
  });

  it("drops phrases below PHRASE_MIN_TF", () => {
    const tf = extractPhraseTf("circuit breaker appears only once here.");
    expect(tf["circuit breaker"]).toBeUndefined();
  });

  it("keeps at most PHRASE_TOP_PER_DOC phrases", () => {
    const pairs = Array.from(
      { length: PHRASE_TOP_PER_DOC + 1 },
      (_, i) => `alpha${i} bravo${i}. alpha${i} bravo${i}`,
    );
    const text = `${"rate limiting ".repeat(6)}${pairs.join(". ")}`;
    const tf = extractPhraseTf(text);
    expect(Object.keys(tf).length).toBe(PHRASE_TOP_PER_DOC);
    expect(tf["rate limiting"]).toBeGreaterThan(PHRASE_MIN_TF);
    for (const count of Object.values(tf)) {
      expect(count).toBeGreaterThanOrEqual(PHRASE_MIN_TF);
    }
    expect(PHRASE_MAX_WORDS).toBe(3);
  });
});
