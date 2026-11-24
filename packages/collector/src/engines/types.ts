export interface EngineCitation {
  url: string;
  title: string | null;
}

export interface EngineAnswer {
  model: string;
  text: string;
  citations: EngineCitation[];
}

export interface Engine {
  slug: string;
  name: string;
  /** Environment variable holding the API key. */
  keyEnv: string;
  ask(prompt: string, apiKey: string): Promise<EngineAnswer>;
}

/** Instruction sent with every prompt so all engines answer from a Canadian point of view. */
export const SYSTEM_PROMPT =
  "You are answering a question from a consumer located in Canada. " +
  "Answer naturally and helpfully, as you would for any user.";

export async function postJson<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${raw.slice(0, 500)}`);
  }
  return JSON.parse(raw) as T;
}
