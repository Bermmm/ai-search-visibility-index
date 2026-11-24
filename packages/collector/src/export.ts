import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";
import type { IndexData, ScoreRow, SourceRow, WeekInfo } from "./export-types.js";
import { WEIGHTS } from "./score.js";

const SOURCES_PER_GROUP = 10;

/**
 * Write index.json for the site. Only aggregates are published — raw answer text stays
 * in the local database.
 */
export function exportJson(db: DB, outDir: string): { file: string; weeks: number; scores: number } {
  const engines = db.prepare<[], { slug: string; name: string }>("SELECT slug, name FROM engines ORDER BY id").all();
  const categories = db
    .prepare<[], { id: number; slug: string; name: string }>("SELECT id, slug, name FROM categories ORDER BY id")
    .all()
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      prompts: db
        .prepare<[number], { text: string }>("SELECT text FROM prompts WHERE category_id = ? AND active = 1 ORDER BY id")
        .all(c.id)
        .map((p) => p.text),
    }));
  const brands = db
    .prepare<[], IndexData["brands"][number]>(
      `SELECT b.slug, b.name, c.slug AS category, b.domain
       FROM brands b JOIN categories c ON c.id = b.category_id ORDER BY c.id, b.name`,
    )
    .all();

  // A week is published once it has scores; use the run those scores came from.
  const weeks = db
    .prepare<[], { week: string; runId: number; isMock: number; collectedAt: string }>(
      `SELECT r.week, r.id AS runId, r.is_mock AS isMock, COALESCE(r.finished_at, r.started_at) AS collectedAt
       FROM runs r
       WHERE r.status = 'completed'
         AND r.week IN (SELECT DISTINCT week FROM weekly_scores)
         AND r.id = (SELECT MAX(id) FROM runs r2 WHERE r2.week = r.week AND r2.status = 'completed')
       ORDER BY r.week`,
    )
    .all()
    .map<WeekInfo>((w) => ({ ...w, isMock: w.isMock === 1 }));

  const scores = db
    .prepare<[], ScoreRow>(
      `SELECT s.week, COALESCE(e.slug, 'all') AS engine, c.slug AS category, b.slug AS brand,
              RANK() OVER (PARTITION BY s.week, s.engine_id, s.category_id ORDER BY s.score DESC) AS rank,
              s.score, s.responses, s.mention_rate AS mentionRate, s.avg_position AS avgPosition,
              s.prominence, s.citation_rate AS citationRate
       FROM weekly_scores s
       JOIN categories c ON c.id = s.category_id
       JOIN brands b ON b.id = s.brand_id
       LEFT JOIN engines e ON e.id = s.engine_id
       ORDER BY s.week, engine, c.id, rank`,
    )
    .all();

  const sources: SourceRow[] = [];
  const sourceQuery = db.prepare<[{ runId: number }], Omit<SourceRow, "week">>(
    `SELECT engine, category, domain, answers, brand FROM (
       SELECT engine, category, domain, answers, brand,
              ROW_NUMBER() OVER (PARTITION BY engine, category ORDER BY answers DESC, domain) AS n
       FROM (
         SELECT e.slug AS engine, c.slug AS category, ci.domain, COUNT(DISTINCT ci.response_id) AS answers,
                MAX(b.slug) AS brand
         FROM citations ci
         JOIN responses r ON r.id = ci.response_id
         JOIN engines e ON e.id = r.engine_id
         JOIN prompts p ON p.id = r.prompt_id
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = ci.brand_id
         WHERE r.run_id = @runId
         GROUP BY e.slug, c.slug, ci.domain
         UNION ALL
         SELECT 'all', c.slug, ci.domain, COUNT(DISTINCT ci.response_id), MAX(b.slug)
         FROM citations ci
         JOIN responses r ON r.id = ci.response_id
         JOIN prompts p ON p.id = r.prompt_id
         JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b ON b.id = ci.brand_id
         WHERE r.run_id = @runId
         GROUP BY c.slug, ci.domain
       )
     ) WHERE n <= ${SOURCES_PER_GROUP}
     ORDER BY engine, category, answers DESC, domain`,
  );
  for (const w of weeks) {
    for (const s of sourceQuery.all({ runId: w.runId })) sources.push({ week: w.week, ...s });
  }

  const data: IndexData = {
    generatedAt: new Date().toISOString(),
    weights: { ...WEIGHTS },
    engines,
    categories,
    brands,
    weeks,
    scores,
    sources,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "index.json");
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return { file, weeks: weeks.length, scores: scores.length };
}
