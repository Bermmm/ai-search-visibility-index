import type { Budget } from "./budget.js";
import type { BrandRow, DB, PromptRow } from "./db.js";
import type { Adapter, AdapterSpec, RunResult } from "./engines/index.js";
import { mockAdapter } from "./engines/mock.js";
import { type BrandMatcher, findMentions, resolveCitations } from "./extract.js";
import { costOf, reserveFor } from "./pricing.js";
import { type RetryOptions, attemptsOf, withRetry } from "./retry.js";

export interface CollectOptions {
  week: string;
  engines: readonly AdapterSpec[];
  /** Times each prompt is asked to each engine, each as a fresh request. */
  samples: number;
  mock: boolean;
  /** Only run the first N prompts (for cheap trial runs). */
  limit?: number;
  /** Required for real runs; null only with mock. */
  budget: Budget | null;
  retry?: RetryOptions;
  log?: (line: string) => void;
}

export interface CollectSummary {
  runId: number;
  planned: number;
  calls: number;
  failures: number;
  costUsd: number;
  /** Set when the run was halted early (e.g. budget cap). */
  stopReason: string | null;
}

export interface RunPlan {
  prompts: PromptRow[];
  engines: AdapterSpec[];
  skippedEngines: string[];
  samples: number;
  calls: number;
  /** Upper-end estimate using each model's per-call reserve. */
  estimatedUsd: number;
}

/** Work out what a run would do, without calling any API or writing anything. */
export function planRun(db: DB, opts: Pick<CollectOptions, "engines" | "samples" | "mock" | "limit">): RunPlan {
  const engines = opts.engines.filter((e) => opts.mock || process.env[e.keyEnv]);
  const skippedEngines = opts.engines.filter((e) => !engines.includes(e)).map((e) => e.slug);

  let prompts = db
    .prepare<[], PromptRow>("SELECT id, category_id, text FROM prompts WHERE active = 1 ORDER BY category_id, id")
    .all();
  if (opts.limit !== undefined) prompts = prompts.slice(0, opts.limit);

  const calls = prompts.length * engines.length * opts.samples;
  const perRound = engines.reduce((sum, e) => sum + (opts.mock ? 0 : reserveFor(e.model())), 0);
  return {
    prompts,
    engines,
    skippedEngines,
    samples: opts.samples,
    calls,
    estimatedUsd: perRound * prompts.length * opts.samples,
  };
}

/**
 * Ask every active prompt to every engine that has an API key, `samples` times each, and store the
 * answers, usage, cost, brand mentions and citations. Engines are queried in parallel; samples and
 * prompts run in sequence. Each call reserves budget first, and the run stops once the cap is hit.
 */
export async function collect(db: DB, opts: CollectOptions): Promise<CollectSummary> {
  const log = opts.log ?? (() => {});
  if (!opts.mock && !opts.budget) throw new Error("A budget is required for real runs (set BUDGET_USD).");

  const plan = planRun(db, opts);
  for (const slug of plan.skippedEngines) log(`skip ${slug}: no API key set`);
  if (plan.engines.length === 0) throw new Error("No engines to run. Add keys to .env, or use --mock.");
  if (plan.prompts.length === 0) throw new Error("No active prompts. Run `aivi init` first.");

  const engineIds = new Map(
    db.prepare<[], { id: number; slug: string }>("SELECT id, slug FROM engines").all().map((r) => [r.slug, r.id]),
  );
  for (const e of plan.engines) {
    if (!engineIds.has(e.slug)) throw new Error(`Engine "${e.slug}" is not in the database. Run \`aivi init\` first.`);
  }

  const brandsByCategory = loadBrandMatchers(db);
  const brandRows = db.prepare<[], BrandRow>("SELECT * FROM brands").all();
  const promptCategory = new Map(plan.prompts.map((p) => [p.text, p.category_id]));
  const adapters: Adapter[] = plan.engines.map((spec) =>
    opts.mock
      ? mockAdapter(spec.slug, spec.name, opts.week, (text) =>
          brandRows.filter((b) => b.category_id === promptCategory.get(text)),
        )
      : spec.create(process.env[spec.keyEnv]!),
  );

  const { id: runId } = db
    .prepare("INSERT INTO runs (week, is_mock, samples, budget_usd) VALUES (?, ?, ?, ?) RETURNING id")
    .get(opts.week, opts.mock ? 1 : 0, opts.samples, opts.budget?.capUsd ?? null) as { id: number };
  log(
    `run ${runId} for ${opts.week}: ${plan.prompts.length} prompts × ${adapters.length} engines × ` +
      `${opts.samples} samples = ${plan.calls} calls${opts.mock ? " (mock)" : ""}`,
  );
  if (opts.budget) {
    log(`budget: $${opts.budget.spentUsd.toFixed(2)} of $${opts.budget.capUsd.toFixed(2)} spent this month`);
  }

  const insertResponse = db.prepare(
    `INSERT INTO responses (run_id, prompt_id, engine_id, sample, model, requested_at, latency_ms, attempts,
       input_tokens, output_tokens, reasoning_tokens, search_calls, cost_usd, response_text, error, raw_json)
     VALUES (@runId, @promptId, @engineId, @sample, @model, @requestedAt, @latencyMs, @attempts,
       @inputTokens, @outputTokens, @reasoningTokens, @searchCalls, @costUsd, @text, @error, @rawJson)
     RETURNING id`,
  );
  const insertMention = db.prepare(
    "INSERT INTO mentions (response_id, brand_id, position, char_offset, matched_alias) VALUES (?, ?, ?, ?, ?)",
  );
  const insertCitation = db.prepare(
    "INSERT INTO citations (response_id, url, domain, title, position, brand_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const addRunCost = db.prepare("UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?");

  interface CallRecord {
    prompt: PromptRow;
    engineId: number;
    sample: number;
    requestedAt: string;
    latencyMs: number;
    attempts: number;
    costUsd: number;
  }

  const saveAnswer = db.transaction((c: CallRecord, result: RunResult) => {
    const { id: responseId } = insertResponse.get({
      runId,
      promptId: c.prompt.id,
      engineId: c.engineId,
      sample: c.sample,
      model: result.model,
      requestedAt: c.requestedAt,
      latencyMs: c.latencyMs,
      attempts: c.attempts,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      searchCalls: result.usage.searchCalls,
      costUsd: c.costUsd,
      text: result.text,
      error: null,
      rawJson: JSON.stringify(result.raw),
    }) as { id: number };
    const brands = brandsByCategory.get(c.prompt.category_id) ?? [];
    for (const m of findMentions(result.text, brands)) {
      insertMention.run(responseId, m.brandId, m.position, m.charOffset, m.matchedAlias);
    }
    for (const cit of resolveCitations(result.citations, brands)) {
      insertCitation.run(responseId, cit.url, cit.domain, cit.title, cit.position, cit.brandId);
    }
    addRunCost.run(c.costUsd, runId);
  });

  // Largest cost seen per engine this run; used to keep budget reservations realistic.
  const maxSeen = new Map<string, number>();
  let calls = 0;
  let failures = 0;
  let costUsd = 0;
  let stopReason: string | null = null;

  const callOnce = async (adapter: Adapter, prompt: PromptRow, sample: number): Promise<void> => {
    const estimate = opts.mock ? 0 : Math.max(reserveFor(adapter.model), maxSeen.get(adapter.slug) ?? 0);
    if (opts.budget && !opts.budget.tryReserve(estimate)) {
      stopReason ??=
        `monthly budget cap reached: $${opts.budget.spentUsd.toFixed(4)} spent of $${opts.budget.capUsd.toFixed(2)}, ` +
        `next ${adapter.slug} call reserves $${estimate.toFixed(4)}`;
      return;
    }

    const engineId = engineIds.get(adapter.slug)!;
    const requestedAt = new Date().toISOString();
    let started = Date.now();
    calls++;
    try {
      const { value: result, attempts } = await withRetry(
        () => {
          started = Date.now();
          return adapter.run(prompt.text);
        },
        {
          ...opts.retry,
          onRetry: (attempt, delayMs, err) =>
            log(`  ↻ ${adapter.slug} attempt ${attempt} failed (${errMessage(err).slice(0, 120)}); retrying in ${delayMs}ms`),
        },
      );
      const latencyMs = Date.now() - started;
      const computed = costOf(result.model, result.usage);
      if (computed === null && !opts.mock) {
        log(`  ! ${adapter.slug}: no usage/pricing for model "${result.model}"; recording reserve estimate $${estimate}`);
      }
      const cost = computed ?? estimate;
      maxSeen.set(adapter.slug, Math.max(maxSeen.get(adapter.slug) ?? 0, cost));
      saveAnswer({ prompt, engineId, sample, requestedAt, latencyMs, attempts, costUsd: cost }, result);
      opts.budget?.settle(estimate, cost);
      costUsd += cost;
    } catch (err) {
      failures++;
      opts.budget?.settle(estimate, 0);
      insertResponse.get({
        runId, promptId: prompt.id, engineId, sample, model: adapter.model, requestedAt,
        latencyMs: Date.now() - started, attempts: attemptsOf(err), inputTokens: null, outputTokens: null,
        reasoningTokens: null, searchCalls: null, costUsd: 0, text: null, error: errMessage(err), rawJson: null,
      });
      log(`  ! ${adapter.slug}: ${errMessage(err).slice(0, 200)}`);
    }
  };

  try {
    outer: for (const [i, prompt] of plan.prompts.entries()) {
      for (let sample = 1; sample <= opts.samples; sample++) {
        await Promise.all(adapters.map((a) => callOnce(a, prompt, sample)));
        if (stopReason) break outer;
      }
      log(`[${i + 1}/${plan.prompts.length}] ${prompt.text}`);
    }
  } finally {
    const status = stopReason ? "stopped" : calls > 0 && failures < calls ? "completed" : "failed";
    db.prepare(
      "UPDATE runs SET status = ?, stop_reason = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ).run(status, stopReason, runId);
  }

  return { runId, planned: plan.calls, calls, failures, costUsd, stopReason };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadBrandMatchers(db: DB): Map<number, BrandMatcher[]> {
  const brands = db.prepare<[], BrandRow>("SELECT * FROM brands").all();
  const aliases = db.prepare<[], { brand_id: number; alias: string }>("SELECT brand_id, alias FROM brand_aliases").all();

  const byCategory = new Map<number, BrandMatcher[]>();
  for (const b of brands) {
    const terms = [b.name, ...aliases.filter((a) => a.brand_id === b.id).map((a) => a.alias)];
    terms.sort((x, y) => y.length - x.length);
    const list = byCategory.get(b.category_id) ?? [];
    list.push({ brandId: b.id, terms, domain: b.domain });
    byCategory.set(b.category_id, list);
  }
  return byCategory;
}
