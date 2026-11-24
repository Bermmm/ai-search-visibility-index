import type { BrandRow, DB, RunRow } from "./db.js";

/** Score weights. Keep these in sync with the README's methodology section. */
export const WEIGHTS = { mention: 0.6, prominence: 0.2, citation: 0.2 } as const;

export interface ScoreSummary {
  week: string;
  runId: number;
  rows: number;
}

interface ResponseFact {
  responseId: number;
  engineId: number;
  categoryId: number;
}

/**
 * Compute weekly_scores for a week from that week's latest completed run.
 * Produces one row per brand for each engine, plus a combined row (engine_id NULL).
 * Existing rows for the week are replaced.
 */
export function score(db: DB, week: string): ScoreSummary {
  const run = db
    .prepare<[string], RunRow>("SELECT * FROM runs WHERE week = ? AND status = 'completed' ORDER BY id DESC LIMIT 1")
    .get(week);
  if (!run) throw new Error(`No completed run for ${week}. Run \`aivi run\` first.`);

  const responses = db
    .prepare<[number], ResponseFact>(
      `SELECT r.id AS responseId, r.engine_id AS engineId, p.category_id AS categoryId
       FROM responses r JOIN prompts p ON p.id = r.prompt_id
       WHERE r.run_id = ? AND r.response_text IS NOT NULL`,
    )
    .all(run.id);

  // response id -> brand id -> position
  const mentions = new Map<number, Map<number, number>>();
  for (const m of db
    .prepare<[number], { response_id: number; brand_id: number; position: number }>(
      `SELECT m.response_id, m.brand_id, m.position FROM mentions m
       JOIN responses r ON r.id = m.response_id WHERE r.run_id = ?`,
    )
    .all(run.id)) {
    if (!mentions.has(m.response_id)) mentions.set(m.response_id, new Map());
    mentions.get(m.response_id)!.set(m.brand_id, m.position);
  }

  // response id -> brand ids whose own domain was cited
  const cited = new Map<number, Set<number>>();
  for (const c of db
    .prepare<[number], { response_id: number; brand_id: number }>(
      `SELECT DISTINCT c.response_id, c.brand_id FROM citations c
       JOIN responses r ON r.id = c.response_id WHERE r.run_id = ? AND c.brand_id IS NOT NULL`,
    )
    .all(run.id)) {
    if (!cited.has(c.response_id)) cited.set(c.response_id, new Set());
    cited.get(c.response_id)!.add(c.brand_id);
  }

  const brands = db.prepare<[], BrandRow>("SELECT * FROM brands").all();
  const engineIds = [...new Set(responses.map((r) => r.engineId))].sort((a, b) => a - b);
  const scopes: Array<number | null> = [null, ...engineIds];

  const insert = db.prepare(
    `INSERT INTO weekly_scores
       (week, engine_id, category_id, brand_id, responses, mention_count, mention_rate, avg_position,
        prominence, citation_count, citation_rate, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let rows = 0;
  db.transaction(() => {
    db.prepare("DELETE FROM weekly_scores WHERE week = ?").run(week);

    for (const engineId of scopes) {
      for (const brand of brands) {
        const pool = responses.filter(
          (r) => r.categoryId === brand.category_id && (engineId === null || r.engineId === engineId),
        );
        if (pool.length === 0) continue;

        const positions = pool
          .map((r) => mentions.get(r.responseId)?.get(brand.id))
          .filter((p): p is number => p !== undefined);
        const citationCount = pool.filter((r) => cited.get(r.responseId)?.has(brand.id)).length;

        const mentionRate = positions.length / pool.length;
        const prominence = positions.reduce((sum, p) => sum + 1 / p, 0) / pool.length;
        const citationRate = citationCount / pool.length;
        const avgPosition = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null;
        const value =
          100 * (WEIGHTS.mention * mentionRate + WEIGHTS.prominence * prominence + WEIGHTS.citation * citationRate);

        insert.run(
          week, engineId, brand.category_id, brand.id, pool.length, positions.length, mentionRate, avgPosition,
          prominence, citationCount, citationRate, Math.round(value * 10) / 10,
        );
        rows++;
      }
    }
  })();

  return { week, runId: run.id, rows };
}
