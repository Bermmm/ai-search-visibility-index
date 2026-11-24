import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_PATH } from "./paths.js";

export type DB = Database.Database;

/** Must match `PRAGMA user_version` at the end of docs/schema.sql. */
export const SCHEMA_VERSION = 2;

/** Open (or create) the SQLite database and make sure the schema exists. */
export function openDb(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const version = db.pragma("user_version", { simple: true }) as number;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() !== undefined;
  if (hasTables && version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `${dbPath} uses schema version ${version}, but this collector needs version ${SCHEMA_VERSION}. ` +
        "There is no automatic migration yet: move the old file aside and run `aivi init` to start fresh.",
    );
  }

  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

// Row shapes for the tables we read back in TypeScript.

export interface CategoryRow {
  id: number;
  slug: string;
  name: string;
}

export interface BrandRow {
  id: number;
  category_id: number;
  slug: string;
  name: string;
  domain: string | null;
}

export interface PromptRow {
  id: number;
  category_id: number;
  text: string;
}

export interface EngineRow {
  id: number;
  slug: string;
  name: string;
}

export interface RunRow {
  id: number;
  week: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "stopped" | "failed";
  stop_reason: string | null;
  samples: number;
  budget_usd: number | null;
  cost_usd: number;
  is_mock: 0 | 1;
}
