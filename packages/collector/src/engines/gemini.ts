import { type Engine, SYSTEM_PROMPT, postJson } from "./types.js";

// Gemini generateContent with Google Search grounding.
// https://ai.google.dev/gemini-api/docs/google-search

interface GeminiResponse {
  modelVersion?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}

export const gemini: Engine = {
  slug: "gemini",
  name: "Gemini (Google)",
  keyEnv: "GEMINI_API_KEY",
  async ask(prompt, apiKey) {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const data = await postJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      },
    );

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    // Gemini returns redirect URLs; the title is usually the source's domain (see extract.ts).
    const citations = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .filter((c) => c.web?.uri)
      .map((c) => ({ url: c.web!.uri!, title: c.web?.title ?? null }));

    return { model: data.modelVersion ?? model, text, citations };
  },
};
