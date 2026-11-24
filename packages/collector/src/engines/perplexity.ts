import { type Engine, SYSTEM_PROMPT, postJson } from "./types.js";

// Perplexity Sonar chat completions, localized to Canada.
// https://docs.perplexity.ai/api-reference/chat-completions-post

interface PerplexityResponse {
  model: string;
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
  search_results?: Array<{ url: string; title?: string }>;
}

export const perplexity: Engine = {
  slug: "perplexity",
  name: "Perplexity",
  keyEnv: "PERPLEXITY_API_KEY",
  async ask(prompt, apiKey) {
    const model = process.env.PERPLEXITY_MODEL || "sonar";
    const data = await postJson<PerplexityResponse>(
      "https://api.perplexity.ai/chat/completions",
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        web_search_options: { user_location: { country: "CA" } },
      },
    );

    const citations = data.search_results?.length
      ? data.search_results.map((r) => ({ url: r.url, title: r.title ?? null }))
      : (data.citations ?? []).map((url) => ({ url, title: null }));

    return { model: data.model, text: data.choices[0]?.message.content ?? "", citations };
  },
};
