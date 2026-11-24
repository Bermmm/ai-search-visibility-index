import { type AdapterSpec, type Citation, SYSTEM_PROMPT, num, postJson } from "./types.js";

// OpenAI Responses API with the built-in web_search tool.
// https://developers.openai.com/api/docs/guides/tools-web-search

interface OpenAIResponse {
  model: string;
  status?: string;
  error?: { message?: string } | null;
  output: Array<{
    type: string;
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
  };
}

export const openai: AdapterSpec = {
  slug: "openai",
  name: "ChatGPT (OpenAI)",
  keyEnv: "OPENAI_API_KEY",
  usesWeb: true,
  model: () => process.env.OPENAI_MODEL || "gpt-5-mini",
  create(apiKey) {
    const model = this.model();
    return {
      slug: this.slug,
      name: this.name,
      model,
      async run(prompt) {
        const raw = await postJson<OpenAIResponse>(
          "https://api.openai.com/v1/responses",
          { authorization: `Bearer ${apiKey}` },
          {
            model,
            instructions: SYSTEM_PROMPT,
            input: prompt,
            // Approximate location keeps search results Canadian, matching the other engines.
            tools: [{ type: "web_search", user_location: { type: "approximate", country: "CA" } }],
            // Don't keep server-side state: every call stands alone.
            store: false,
          },
        );
        if (raw.status === "failed" || raw.error) throw new Error(`OpenAI response failed: ${raw.error?.message ?? raw.status}`);

        const texts: string[] = [];
        const citations: Citation[] = [];
        let searchCalls = 0;
        for (const item of raw.output) {
          if (item.type === "web_search_call") searchCalls++;
          if (item.type !== "message") continue;
          for (const part of item.content ?? []) {
            if (part.type !== "output_text") continue;
            texts.push(part.text ?? "");
            for (const a of part.annotations ?? []) {
              if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? null });
            }
          }
        }

        return {
          text: texts.join("\n"),
          citations,
          model: raw.model,
          raw,
          usage: {
            inputTokens: num(raw.usage?.input_tokens),
            cachedInputTokens: num(raw.usage?.input_tokens_details?.cached_tokens),
            outputTokens: num(raw.usage?.output_tokens),
            reasoningTokens: num(raw.usage?.output_tokens_details?.reasoning_tokens),
            searchCalls,
            providerCostUsd: null,
          },
        };
      },
    };
  },
};
