import { type AdapterSpec, SYSTEM_PROMPT, num, postJson } from "./types.js";

// Gemini generateContent WITHOUT the google_search grounding tool.
// Google's terms for Grounding with Google Search don't allow storing or analyzing grounded results,
// so this engine measures what the model says from its own training ("model memory"), with no web
// access. It therefore never has citations. https://ai.google.dev/gemini-api/docs/text-generation

interface GeminiResponse {
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export const gemini: AdapterSpec = {
  slug: "gemini",
  name: "Gemini (model memory, no web)",
  keyEnv: "GEMINI_API_KEY",
  usesWeb: false,
  model: () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  create(apiKey) {
    const model = this.model();
    return {
      slug: this.slug,
      name: this.name,
      model,
      async run(prompt) {
        const raw = await postJson<GeminiResponse>(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { "x-goog-api-key": apiKey },
          {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            // Deliberately no `tools`: no Google Search grounding.
          },
        );
        const candidate = raw.candidates?.[0];
        if (!candidate) throw new Error(`Gemini returned no answer (${raw.promptFeedback?.blockReason ?? "no candidates"})`);

        const text = (candidate.content?.parts ?? [])
          .filter((p) => !p.thought)
          .map((p) => p.text ?? "")
          .join("");
        const u = raw.usageMetadata;
        const thoughts = num(u?.thoughtsTokenCount);
        const answerTokens = num(u?.candidatesTokenCount);

        return {
          text,
          citations: [],
          model: raw.modelVersion ?? model,
          raw,
          usage: {
            inputTokens: num(u?.promptTokenCount),
            cachedInputTokens: num(u?.cachedContentTokenCount),
            // Thinking tokens are billed at the output rate.
            outputTokens: answerTokens === null && thoughts === null ? null : (answerTokens ?? 0) + (thoughts ?? 0),
            reasoningTokens: thoughts,
            searchCalls: 0,
            providerCostUsd: null,
          },
        };
      },
    };
  },
};
