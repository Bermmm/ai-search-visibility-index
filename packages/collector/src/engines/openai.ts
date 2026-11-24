import { type Engine, type EngineCitation, SYSTEM_PROMPT, postJson } from "./types.js";

// OpenAI Responses API with the built-in web search tool, localized to Canada.
// https://platform.openai.com/docs/api-reference/responses

interface OpenAIResponse {
  model: string;
  output: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      annotations?: Array<{ type: string; url?: string; title?: string }>;
    }>;
  }>;
}

export const openai: Engine = {
  slug: "openai",
  name: "ChatGPT (OpenAI)",
  keyEnv: "OPENAI_API_KEY",
  async ask(prompt, apiKey) {
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const data = await postJson<OpenAIResponse>(
      "https://api.openai.com/v1/responses",
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        instructions: SYSTEM_PROMPT,
        input: prompt,
        tools: [{ type: "web_search", user_location: { type: "approximate", country: "CA" } }],
      },
    );

    const texts: string[] = [];
    const citations: EngineCitation[] = [];
    for (const item of data.output) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        texts.push(part.text ?? "");
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? null });
        }
      }
    }
    return { model: data.model, text: texts.join("\n"), citations };
  },
};
