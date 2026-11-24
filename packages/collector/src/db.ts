import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_PATH } from "./paths.js";

export type DB = Database.Database;

/** Open (or create) the SQLite database and make sure the schema exists. */
export function openDb(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
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
  status: "running" | "completed" | "failed";
  is_mock: 0 | 1;
}
