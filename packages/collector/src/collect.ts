import type { BrandRow, DB, PromptRow } from "./db.js";
import { type Engine, type EngineAnswer } from "./engines/index.js";
import { mockAnswer } from "./engines/mock.js";
import { type BrandMatcher, findMentions, resolveCitations } from "./extract.js";

export interface CollectOptions {
  week: string;
  engines: readonly Engine[];
  mock: boolean;
  /** Only run the first N prompts (handy for a cheap smoke test). */
  limit?: number;
  log?: (line: string) => void;
}

export interface CollectSummary {
  runId: number;
  calls: number;
  failures: number;
  skippedEngines: string[];
}

/**
 * Ask every active prompt to every engine that has an API key, and store the answers,
 * brand mentions and citations. Engines are queried in parallel for each prompt.
 */
export async function collect(db: DB, opts: CollectOptions): Promise<CollectSummary> {
  const log = opts.log ?? (() => {});

  const ready = opts.engines.filter((e) => opts.mock || process.env[e.keyEnv]);
  const skippedEngines = opts.engines.filter((e) => !ready.includes(e)).map((e) => e.slug);
  for (const slug of skippedEngines) log(`skip ${slug}: no API key set`);
  if (ready.length === 0) throw new Error("No engines to run. Add keys to .env, or use --mock.");

  const engineIds = new Map(
    db.prepare<[], { id: number; slug: string }>("SELECT id, slug FROM engines").all().map((r) => [r.slug, r.id]),
  );
  for (const e of ready) {
    if (!engineIds.has(e.slug)) throw new Error(`Engine "${e.slug}" is not in the database. Run \`aivi init\` first.`);
  }

  let prompts = db
    .prepare<[], PromptRow>("SELECT id, category_id, text FROM prompts WHERE active = 1 ORDER BY category_id, id")
    .all();
  if (opts.limit !== undefined) prompts = prompts.slice(0, opts.limit);
  if (prompts.length === 0) throw new Error("No active prompts. Run `aivi init` first.");

  const brandsByCategory = loadBrandMatchers(db);
  const brandRows = db.prepare<[], BrandRow>("SELECT * FROM brands").all();

  const { id: runId } = db
    .prepare("INSERT INTO runs (week, is_mock) VALUES (?, ?) RETURNING id")
    .get(opts.week, opts.mock ? 1 : 0) as { id: number };
  log(`run ${runId} for ${opts.week}: ${prompts.length} prompts × ${ready.length} engines${opts.mock ? " (mock)" : ""}`);

  const insertResponse = db.prepare(
    `INSERT INTO responses (run_id, prompt_id, engine_id, model, response_text, error, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertMention = db.prepare(
    "INSERT INTO mentions (response_id, brand_id, position, char_offset, matched_alias) VALUES (?, ?, ?, ?, ?)",
  );
  const insertCitation = db.prepare(
    "INSERT INTO citations (response_id, url, domain, title, position, brand_id) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const saveAnswer = db.transaction(
    (prompt: PromptRow, engineId: number, answer: EngineAnswer, latencyMs: number) => {
      const { id: responseId } = insertResponse.get(
        runId, prompt.id, engineId, answer.model, answer.text, null, latencyMs,
      ) as { id: number };
      const brands = brandsByCategory.get(prompt.category_id) ?? [];
      for (const m of findMentions(answer.text, brands)) {
        insertMention.run(responseId, m.brandId, m.position, m.charOffset, m.matchedAlias);
      }
      for (const c of resolveCitations(answer.citations, brands)) {
        insertCitation.run(responseId, c.url, c.domain, c.title, c.position, c.brandId);
      }
    },
  );

  let calls = 0;
  let failures = 0;
  try {
    for (const [i, prompt] of prompts.entries()) {
      const categoryBrands = brandRows.filter((b) => b.category_id === prompt.category_id);
      await Promise.all(
        ready.map(async (engine) => {
          const engineId = engineIds.get(engine.slug)!;
          const started = Date.now();
          try {
            const answer = opts.mock
              ? mockAnswer(engine.slug, prompt.text, opts.week, categoryBrands)
              : await engine.ask(prompt.text, process.env[engine.keyEnv]!);
            saveAnswer(prompt, engineId, answer, Date.now() - started);
          } catch (err) {
            failures++;
            const message = err instanceof Error ? err.message : String(err);
            insertResponse.run(runId, prompt.id, engineId, "unknown", null, message, Date.now() - started);
            log(`  ! ${engine.slug}: ${message.slice(0, 200)}`);
          }
          calls++;
        }),
      );
      log(`[${i + 1}/${prompts.length}] ${prompt.text}`);
    }
  } finally {
    const status = calls > 0 && failures < calls ? "completed" : "failed";
    db.prepare("UPDATE runs SET status = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(
      status,
      runId,
    );
  }

  return { runId, calls, failures, skippedEngines };
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
