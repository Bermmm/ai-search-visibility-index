#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Budget, monthStartUtc, readBudgetCap, spentThisMonth } from "./budget.js";
import { collect, planRun } from "./collect.js";
import { openDb } from "./db.js";
import { ADAPTERS } from "./engines/index.js";
import { exportJson } from "./export.js";
import { DEFAULT_DB_PATH, DEFAULT_EXPORT_DIR, ENV_PATH } from "./paths.js";
import { score } from "./score.js";
import { seed } from "./seed.js";
import { isValidWeek, isoWeek } from "./week.js";

const DEFAULT_SAMPLES = 2;

const HELP = `aivi — AI Search Visibility Index collector

Usage: aivi <command> [options]

Commands:
  init      Create the database from docs/schema.sql and load seed/canada.json
  run       Ask every active prompt to each engine, then score the week
  score     Recompute scores for a week from its latest completed run
  export    Write packages/site/public/data/index.json for the dashboard
  status    Show this month's spend and recent runs

Options:
  --db <path>        SQLite file (default: data/index.db)
  --week <YYYY-Www>  ISO week to run or score (default: current week)
  --engines <list>   Comma-separated engine slugs (default: ${ADAPTERS.map((e) => e.slug).join(",")})
  --samples <n>      run: times to ask each prompt to each engine (default: ${DEFAULT_SAMPLES})
  --limit <n>        run: only the first n prompts (cheap trial run)
  --dry-run          run: print the plan and estimated cost; call nothing, write nothing
  --mock             run: use fake answers instead of calling APIs (no cost, no budget needed)
  --out <dir>        export: output directory
  -h, --help         Show this help

Real runs require BUDGET_USD (a hard monthly cap in USD) in .env.
`;

async function main(): Promise<void> {
  if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: "string", default: DEFAULT_DB_PATH },
      week: { type: "string" },
      engines: { type: "string" },
      samples: { type: "string" },
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
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
        log(
          `${s.categories} categories, ${s.brands} brands, ${s.activePrompts} active prompts` +
            (s.retiredPrompts ? `, ${s.retiredPrompts} retired` : ""),
        );
        break;
      }

      case "run": {
        const engines = selectEngines(values.engines);
        const samples = positiveInt("--samples", values.samples) ?? DEFAULT_SAMPLES;
        const limit = positiveInt("--limit", values.limit);
        const mock = values.mock;
        const cap = readBudgetCap();
        const spent = spentThisMonth(db);

        if (values["dry-run"]) {
          const plan = planRun(db, { engines, samples, mock, limit });
          log(`dry run for ${week}${mock ? " (mock)" : ""}: nothing will be called or written`);
          for (const slug of plan.skippedEngines) log(`  skip ${slug}: no API key set`);
          for (const e of plan.engines) log(`  ${e.slug.padEnd(11)} ${e.model()}`);
          log(`  ${plan.prompts.length} prompts × ${plan.engines.length} engines × ${samples} samples = ${plan.calls} calls`);
          log(`  estimated cost: up to $${plan.estimatedUsd.toFixed(2)}`);
          log(
            cap === null
              ? "  BUDGET_USD is not set (required for a real run)"
              : `  budget: $${spent.toFixed(2)} of $${cap.toFixed(2)} spent this month, $${Math.max(0, cap - spent).toFixed(2)} left`,
          );
          break;
        }

        let budget: Budget | null = null;
        if (!mock) {
          if (cap === null) throw new Error("Set BUDGET_USD in .env (a hard monthly cap in USD) before a real run.");
          if (spent >= cap) throw new Error(`Monthly budget used up: $${spent.toFixed(2)} of $${cap.toFixed(2)}.`);
          budget = new Budget(cap, spent);
        }

        const c = await collect(db, { week, engines, samples, mock, limit, budget, log });
        log(
          `run ${c.runId}: ${c.calls - c.failures}/${c.planned} answers stored, ${c.failures} failed, ` +
            `cost $${c.costUsd.toFixed(4)}`,
        );
        if (c.stopReason) {
          log(`STOPPED: ${c.stopReason}`);
          log("The run is incomplete and will not be scored. Raise BUDGET_USD or wait for next month, then re-run.");
          process.exitCode = 2;
          break;
        }
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
        const cap = readBudgetCap();
        const spent = spentThisMonth(db);
        log(
          `spent since ${monthStartUtc().slice(0, 10)} (UTC): $${spent.toFixed(4)}` +
            (cap === null ? " (BUDGET_USD not set)" : ` of $${cap.toFixed(2)}`),
        );
        const runs = db
          .prepare<
            [],
            { id: number; week: string; status: string; is_mock: number; started_at: string; samples: number; cost_usd: number; n: number; errors: number; stop_reason: string | null }
          >(
            `SELECT r.id, r.week, r.status, r.is_mock, r.started_at, r.samples, r.cost_usd, r.stop_reason,
                    COUNT(x.id) AS n, COALESCE(SUM(x.error IS NOT NULL), 0) AS errors
             FROM runs r LEFT JOIN responses x ON x.run_id = r.id
             GROUP BY r.id ORDER BY r.id DESC LIMIT 10`,
          )
          .all();
        if (runs.length === 0) log("No runs yet.");
        for (const r of runs) {
          log(
            `#${r.id}  ${r.week}  ${r.status.padEnd(9)}  ${r.n} calls (×${r.samples}), ${r.errors} errors, ` +
              `$${r.cost_usd.toFixed(4)}${r.is_mock ? "  [mock]" : ""}  ${r.started_at}`,
          );
          if (r.stop_reason) log(`      ${r.stop_reason}`);
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
  if (!list) return ADAPTERS;
  const slugs = list.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = slugs.filter((s) => !ADAPTERS.some((e) => e.slug === s));
  if (unknown.length) throw new Error(`Unknown engine(s): ${unknown.join(", ")}`);
  return ADAPTERS.filter((e) => slugs.includes(e.slug));
}

function positiveInt(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
