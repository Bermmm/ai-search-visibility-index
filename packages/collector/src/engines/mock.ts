import type { EngineAnswer } from "./types.js";

/**
 * Fake answers for testing the pipeline without API keys (`aivi run --mock`).
 * Deterministic for a given (engine, prompt, week), so re-runs are reproducible.
 * Runs made this way are flagged is_mock = 1 and the site labels them as demo data.
 */
export function mockAnswer(
  engineSlug: string,
  prompt: string,
  week: string,
  brands: Array<{ name: string; domain: string | null }>,
): EngineAnswer {
  const rand = seeded(`${engineSlug}|${prompt}|${week}`);
  const picked = [...brands].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * Math.min(4, brands.length)));

  const text =
    picked.length === 0
      ? "It depends on your needs; compare a few options before deciding."
      : `Popular options in Canada include ${picked.map((b) => b.name).join(", ")}. Compare fees and reviews before choosing.`;

  const citations = picked
    .filter((b) => b.domain && rand() < 0.5)
    .map((b) => ({ url: `https://www.${b.domain}/`, title: b.name }));
  citations.push({ url: "https://www.example-review-site.ca/best-picks", title: "Example review site" });

  return { model: "mock-1", text, citations };
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
