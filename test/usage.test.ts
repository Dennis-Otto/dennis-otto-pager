// The footer of an answer of Claude: the short name of each model, the numbers of
// each language, and what the footer says in German.
import { describe, expect, it } from "vitest";

import { texts } from "../src/texts.ts";
import { EFFORTS, footer, modelName } from "../src/usage.ts";

describe("the footer of an answer", () => {
  it("names a model by its family and version", () => {
    expect(
      [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5-1",
        "claude-opus-5-5-20261101",
        "claude-opus-4@20250514",
        "claude-sonnet-5-5[1m]",
        "claude-3-5-haiku-20241022",
        "claude-sonnet-4",
      ].map(modelName),
    ).toEqual([
      "Opus 5.5",
      "Sonnet 5.5",
      "Haiku 5.5",
      "Fable 5.1",
      "Opus 5.5",
      "Opus 4",
      "Sonnet 5.5",
      "Haiku 3.5",
      "Sonnet 4",
    ]);
  });

  it("keeps an id of another form as it is", () => {
    for (const id of [
      "gpt-5",
      "anthropic.claude-opus-5-5",
      "claude-opus",
      "claude-5-5",
      "claude-opus-sonnet-5",
      "claude-opus-5-5-1",
      "claude-opus-123",
      "claude-opus-5-5b",
    ]) {
      expect(modelName(id)).toBe(id);
    }
  });

  it("writes the numbers of each language", () => {
    const en = texts("en");
    const de = texts("de");
    expect([0, 999, 1000, 48213, 1234567].map(en.number)).toEqual([
      "0",
      "999",
      "1,000",
      "48,213",
      "1,234,567",
    ]);
    expect([999, 48213, 1234567].map(de.number)).toEqual([
      "999",
      "48.213",
      "1.234.567",
    ]);
  });

  it("says the effort in German, and the tokens with German numbers", () => {
    const de = texts("de");
    const models = [{ model: "claude-opus-5-5", tokens: 48213 }];
    expect(
      EFFORTS.map((effort) =>
        footer({ turns: 4, seconds: 52, effort, models }, de),
      ),
    ).toEqual([
      "🧮 Opus 5.5 · Niedrig · 48.213 Tokens",
      "🧮 Opus 5.5 · Mittel · 48.213 Tokens",
      "🧮 Opus 5.5 · Hoch · 48.213 Tokens",
      "🧮 Opus 5.5 · Extra Hoch · 48.213 Tokens",
      "🧮 Opus 5.5 · Max · 48.213 Tokens",
    ]);
    expect(
      footer(
        {
          turns: 4,
          seconds: 52,
          effort: "high",
          models: [
            { model: "claude-haiku-5-5", tokens: 1000 },
            { model: "claude-opus-5-5", tokens: 3000 },
          ],
        },
        de,
      ),
    ).toBe("🧮 Opus 5.5 75 %, Haiku 5.5 25 % · Hoch · 4.000 Tokens");
    expect(footer({ turns: 4, seconds: 52 }, de)).toBe(
      "🧮 Claude: 4 Runden, 52 s, von deinem Wochenlimit",
    );
    expect(footer(undefined, de)).toBeNull();
  });
});
