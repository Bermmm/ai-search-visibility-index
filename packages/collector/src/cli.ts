#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { collect } from "./collect.js";
import { openDb } from "./db.js";
import { ENGINES } from "./engines/index.js";
import { exportJson } from "./export.js";
import { DEFAULT_DB_PATH, DEFAULT_EXPORT_DIR, ENV_PATH } from "./paths.js";
import { score } from "./score.js";
import { seed } from "./seed.js";
import { isValidWeek, isoWeek } from "./week.js";

const HELP = `aivi — AI Search Visibility Index collector

Usage: aivi <command> [options]

Commands:
  init      Create the database from docs/schema.sql and load seed/canada.json
  run       Ask every active prompt to each engine, then score the week
  score     Recompute scores for a week from its latest completed run
  export    Write packages/site/public/data/index.json for the dashboard
  status    Show recent runs

Options:
  --db <path>        SQLite file (default: data/index.db)
  --week <YYYY-Www>  ISO week to run or score (default: current week)
  --engines <list>   Comma-separated engine slugs (default: ${ENGINES.map((e) => e.slug).join(",")})
  --limit <n>        run: only the first n prompts (cheap smoke test)
  --mock             run: use fake answers instead of calling APIs
  --out <dir>        export: output directory
  -h, --help         Show this help
`;

async function main(): Promise<void> {
  if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: "string", default: DEFAULT_DB_PATH },
      week: { type: "string" },
      engines: { type: "string" },
      limit: { type: "string" },
      mock: { type: "boolean", default: false },
      out: { type: "string", default: DEFAULT_EXPORT_DIR },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }

  const week = values.week ?? isoWeek();
  if (!isValidWeek(week)) throw new Error(`Invalid --week "${week}". Expected e.g. 2026-W48.`);

  // pnpm runs scripts from the package folder; resolve relative paths against where the user typed the command.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const db = openDb(path.resolve(cwd, values.db));
  const log = (line: string) => console.log(line);

  try {
    switch (command) {
      case "init": {
        const s = seed(db);
        log(`Database ready at ${values.db}`);
        log(`${s.categories} categories, ${s.brands} brands, ${s.activePrompts} active prompts` +
          (s.retiredPrompts ? `, ${s.retiredPrompts} retired` : ""));
        break;
      }

      case "run": {
        const engines = selectEngines(values.engines);
        const limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);
        if (limit !== undefined && !(limit > 0)) throw new Error("--limit must be a positive integer");

        const c = await collect(db, { week, engines, mock: values.mock, limit, log });
        log(`run ${c.runId}: ${c.calls - c.failures}/${c.calls} answers stored, ${c.failures} failed`);
        if (c.failures === c.calls) throw new Error("Every call failed; nothing to score.");
        const s = score(db, week);
        log(`scored ${week}: ${s.rows} rows`);
        break;
      }

      case "score": {
        const s = score(db, week);
        log(`scored ${week} from run ${s.runId}: ${s.rows} rows`);
        break;
      }

      case "export": {
        const e = exportJson(db, path.resolve(cwd, values.out));
        log(`wrote ${e.file} (${e.weeks} weeks, ${e.scores} score rows)`);
        break;
      }

      case "status": {
        const runs = db
          .prepare<[], { id: number; week: string; status: string; is_mock: number; started_at: string; n: number; errors: number }>(
            `SELECT r.id, r.week, r.status, r.is_mock, r.started_at,
                    COUNT(x.id) AS n, COALESCE(SUM(x.error IS NOT NULL), 0) AS errors
             FROM runs r LEFT JOIN responses x ON x.run_id = r.id
             GROUP BY r.id ORDER BY r.id DESC LIMIT 10`,
          )
          .all();
        if (runs.length === 0) log("No runs yet.");
        for (const r of runs) {
          log(`#${r.id}  ${r.week}  ${r.status.padEnd(9)}  ${r.n} responses, ${r.errors} errors` +
            `${r.is_mock ? "  [mock]" : ""}  ${r.started_at}`);
        }
        break;
      }

      default:
        throw new Error(`Unknown command "${command}". Run with --help.`);
    }
  } finally {
    db.close();
  }
}

function selectEngines(list: string | undefined) {
  if (!list) return ENGINES;
  const slugs = list.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = slugs.filter((s) => !ENGINES.some((e) => e.slug === s));
  if (unknown.length) throw new Error(`Unknown engine(s): ${unknown.join(", ")}`);
  return ENGINES.filter((e) => slugs.includes(e.slug));
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
