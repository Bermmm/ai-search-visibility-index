export interface Citation {
  url: string;
  title: string | null;
}

/** Token and tool usage as reported by the provider. Null when the provider didn't report it. */
export interface Usage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  /** Includes reasoning/thinking tokens. */
  outputTokens: number | null;
  reasoningTokens: number | null;
  /** Billable web searches the engine ran for this answer. */
  searchCalls: number | null;
  /** Cost in USD when the provider reports it directly; otherwise computed from src/pricing.ts. */
  providerCostUsd: number | null;
}

/** What every adapter returns for one prompt. */
export interface RunResult {
  text: string;
  citations: Citation[];
  /** Model id the API says it served (may be more specific than the one requested). */
  model: string;
  /** The full, unmodified response body, stored in responses.raw_json. */
  raw: unknown;
  usage: Usage;
}

/** One AI engine. Each call is a fresh, stateless request: no conversation history. */
export interface Adapter {
  slug: string;
  name: string;
  /** Model id we request. */
  model: string;
  run(prompt: string): Promise<RunResult>;
}

export interface AdapterSpec {
  slug: string;
  name: string;
  /** Environment variable holding the API key. */
  keyEnv: string;
  /** False when the engine answers from model memory only, so it never has citations. */
  usesWeb: boolean;
  /** Model id requested (see each adapter for the env override). */
  model(): string;
  create(apiKey: string): Adapter;
}

/** Instruction sent with every prompt so all engines answer from a Canadian point of view. */
export const SYSTEM_PROMPT =
  "You are answering a question from a consumer located in Canada. " +
  "Answer naturally and helpfully, as you would for any user.";

/** Non-2xx HTTP response. Carries what the retry logic needs. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
  }
}

export const REQUEST_TIMEOUT_MS = 120_000;

/** POST JSON and parse the JSON reply. Throws HttpError on non-2xx. */
export async function postJson<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, parseRetryAfter(res.headers.get("retry-after")));
  return JSON.parse(text) as T;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
