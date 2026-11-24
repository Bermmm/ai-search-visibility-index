import type { Adapter } from "./types.js";

export interface MockBrand {
  name: string;
  domain: string | null;
}

/**
 * Fake adapter for testing the pipeline without API keys (`aivi run --mock`).
 * Answers are deterministic for a given (engine, prompt, week, sample), cost nothing and are
 * flagged is_mock = 1; the site labels those weeks as demo data.
 */
export function mockAdapter(
  slug: string,
  name: string,
  week: string,
  brandsFor: (prompt: string) => MockBrand[],
): Adapter {
  const samples = new Map<string, number>();
  return {
    slug,
    name,
    model: "mock-1",
    async run(prompt) {
      const sample = (samples.get(prompt) ?? 0) + 1;
      samples.set(prompt, sample);
      const rand = seeded(`${slug}|${prompt}|${week}|${sample}`);
      const brands = brandsFor(prompt);
      const picked = [...brands]
        .sort(() => rand() - 0.5)
        .slice(0, 1 + Math.floor(rand() * Math.min(4, brands.length)));

      const text =
        picked.length === 0
          ? "It depends on your needs; compare a few options before deciding."
          : `Popular options in Canada include ${picked.map((b) => b.name).join(", ")}. Compare fees and reviews before choosing.`;

      const citations =
        slug === "gemini"
          ? [] // mirrors the real Gemini adapter: no web, no citations
          : [
              ...picked
                .filter((b) => b.domain && rand() < 0.5)
                .map((b) => ({ url: `https://www.${b.domain}/`, title: b.name })),
              { url: "https://www.example-review-site.ca/best-picks", title: "Example review site" },
            ];

      const raw = { mock: true, text };
      return {
        text,
        citations,
        model: "mock-1",
        raw,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          searchCalls: 0,
          providerCostUsd: 0,
        },
      };
    },
  };
}

// Small string-seeded PRNG (mulberry32 over an FNV-1a hash).
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
