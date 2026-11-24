import { type AdapterSpec, type Citation, SYSTEM_PROMPT, num, postJson } from "./types.js";

// Perplexity Agent API with the web_search tool.
// https://docs.perplexity.ai/docs/agent-api/quickstart
// https://docs.perplexity.ai/docs/agent-api/tools/web-search

interface PerplexityAgentResponse {
  model: string;
  status?: string;
  error?: { message?: string } | null;
  output: Array<{
    type: string;
    results?: Array<{ id?: number; url?: string; title?: string }>;
    content?: Array<{
      type: string;
      text?: string;
      annotations?: Array<{ type: string; url?: string; title?: string }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    cost?: { total_cost?: number };
    tool_calls_details?: Record<string, { invocation?: number }>;
  };
}

export const perplexity: AdapterSpec = {
  slug: "perplexity",
  name: "Perplexity",
  keyEnv: "PERPLEXITY_API_KEY",
  usesWeb: true,
  model: () => process.env.PERPLEXITY_MODEL || "perplexity/sonar",
  create(apiKey) {
    const model = this.model();
    return {
      slug: this.slug,
      name: this.name,
      model,
      async run(prompt) {
        const raw = await postJson<PerplexityAgentResponse>(
          "https://api.perplexity.ai/v1/agent",
          { authorization: `Bearer ${apiKey}` },
          {
            model,
            instructions: SYSTEM_PROMPT,
            input: prompt,
            tools: [{ type: "web_search", user_location: { country: "CA" } }],
            // Room for a search step and an answer step (the default for a single model is 1 step).
            max_steps: 3,
            store: false,
          },
        );
        if (raw.status === "failed" || raw.error) {
          throw new Error(`Perplexity response failed: ${raw.error?.message ?? raw.status}`);
        }

        const texts: string[] = [];
        const annotated: Citation[] = [];
        const results: SearchResult[] = [];
        for (const item of raw.output) {
          if (item.type === "search_results") {
            for (const r of item.results ?? []) {
              if (r.url) results.push({ id: r.id ?? null, citation: { url: r.url, title: r.title ?? null } });
            }
          }
          if (item.type !== "message") continue;
          for (const part of item.content ?? []) {
            if (part.type !== "output_text") continue;
            texts.push(part.text ?? "");
            for (const a of part.annotations ?? []) {
              if (a.type === "url_citation" && a.url) annotated.push({ url: a.url, title: a.title ?? null });
            }
          }
        }
        const text = texts.join("\n");

        return {
          text,
          citations: pickCitations(text, annotated, results),
          model: raw.model,
          raw,
          usage: {
            inputTokens: num(raw.usage?.input_tokens),
            cachedInputTokens: num(raw.usage?.input_tokens_details?.cached_tokens),
            outputTokens: num(raw.usage?.output_tokens),
            reasoningTokens: num(raw.usage?.output_tokens_details?.reasoning_tokens),
            searchCalls: num(raw.usage?.tool_calls_details?.search_web?.invocation),
            providerCostUsd: num(raw.usage?.cost?.total_cost),
          },
        };
      },
    };
  },
};

interface SearchResult {
  id: number | null;
  citation: Citation;
}

/**
 * Perplexity cites sources with [n] markers that point at search result ids. Keep the results the
 * answer actually cites, plus any url_citation annotations. If the answer has neither markers nor
 * annotations, fall back to every search result (the sources the answer was built from).
 * The full result list is always kept in raw_json.
 */
export function pickCitations(text: string, annotated: Citation[], results: SearchResult[]): Citation[] {
  const referenced = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  if (referenced.size) {
    return [...annotated, ...results.filter((r) => r.id !== null && referenced.has(r.id)).map((r) => r.citation)];
  }
  return annotated.length ? annotated : results.map((r) => r.citation);
}
