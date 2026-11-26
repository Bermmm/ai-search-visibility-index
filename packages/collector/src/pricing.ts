import type { Usage } from "./engines/types.js";

/**
 * List prices in USD, standard tier. Update these when providers change prices.
 * Checked 2026-11-24 against:
 *   OpenAI     https://developers.openai.com/api/docs/pricing
 *   Perplexity https://docs.perplexity.ai/docs/getting-started/pricing  (Agent API models table)
 *   Gemini     https://aistudio.google.com/docs/pricing
 */
export interface Price {
  inputPerMTok: number;
  cachedInputPerMTok: number;
  /** Output rate; reasoning/thinking tokens are billed as output by all three providers. */
  outputPerMTok: number;
  perSearchCall: number;
  /**
   * Conservative per-call estimate used to reserve budget before a call is made
   * (roughly 10k input + 4k output tokens + 2 searches, rounded up).
   */
  reserveUsd: number;
}

/**
 * Keyed by model id. A served id also matches when it only adds a dated/versioned suffix
 * ("gpt-5-mini-2025-08-07", "gemini-3.5-flash-lite-001"), but not a different variant ("perplexity/sonar-pro").
 */
export const PRICES: Record<string, Price> = {
  // Web search: $10 / 1k calls; search content tokens are billed as input tokens at model rates.
  "gpt-5-mini": { inputPerMTok: 0.25, cachedInputPerMTok: 0.025, outputPerMTok: 2.0, perSearchCall: 0.01, reserveUsd: 0.04 },
  // Agent API web_search (search_type "web"): $2.50 / 1k invocations. Perplexity also reports its own cost.
  "perplexity/sonar": { inputPerMTok: 0.25, cachedInputPerMTok: 0.0625, outputPerMTok: 2.5, perSearchCall: 0.0025, reserveUsd: 0.02 },
  // No search tool is used for Gemini.
  "gemini-3.5-flash-lite": { inputPerMTok: 0.3, cachedInputPerMTok: 0.03, outputPerMTok: 2.5, perSearchCall: 0, reserveUsd: 0.015 },
};

/** Used to reserve budget for a model missing from PRICES. Deliberately pessimistic. */
export const UNKNOWN_MODEL_RESERVE_USD = 0.1;

export function priceFor(model: string): Price | null {
  const key = Object.keys(PRICES)
    .filter((k) => new RegExp(`^(models/)?${escape(k)}([-@]\\d[\\w.-]*)?$`).test(model))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key]! : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function reserveFor(model: string): number {
  return priceFor(model)?.reserveUsd ?? UNKNOWN_MODEL_RESERVE_USD;
}

/**
 * Cost of one call in USD. Prefers the provider's own figure when it reports one;
 * otherwise computes it from token usage and PRICES. Returns null if it can't be determined.
 */
export function costOf(model: string, usage: Usage): number | null {
  if (usage.providerCostUsd !== null) return usage.providerCostUsd;
  const p = priceFor(model);
  if (!p || usage.inputTokens === null || usage.outputTokens === null) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  return (
    ((usage.inputTokens - cached) * p.inputPerMTok +
      cached * p.cachedInputPerMTok +
      usage.outputTokens * p.outputPerMTok) /
      1_000_000 +
    (usage.searchCalls ?? 0) * p.perSearchCall
  );
}
