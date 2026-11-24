-- AI Search Visibility Index (Canada) — SQLite schema.
-- This file is the source of truth. The collector applies it on `init`, and every
-- statement is idempotent (IF NOT EXISTS), so it is safe to re-run.

PRAGMA foreign_keys = ON;

-- A market vertical we track, e.g. "Banking" or "Telecom".
CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

-- A brand competing inside one category.
-- `domain` is the brand's own website (e.g. "rbc.com"); citations to it count as owned citations.
CREATE TABLE IF NOT EXISTS brands (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  domain       TEXT
);

-- Other names a brand goes by ("RBC", "Royal Bank"). Matching is case-sensitive, whole-word.
-- The brand's own `name` is always matched too, so it does not need an alias row.
CREATE TABLE IF NOT EXISTS brand_aliases (
  id        INTEGER PRIMARY KEY,
  brand_id  INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  UNIQUE (brand_id, alias)
);

-- A question a Canadian consumer might ask an AI assistant.
-- Prompts are never edited in place: retire one with active = 0 and add a new one,
-- so week-over-week comparisons stay honest.
CREATE TABLE IF NOT EXISTS prompts (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  text         TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (category_id, text)
);

-- An AI answer engine we query (OpenAI, Perplexity, Gemini).
CREATE TABLE IF NOT EXISTS engines (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

-- One collection pass. `week` is an ISO week label such as "2026-W48".
CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY,
  week         TEXT NOT NULL,
  started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at  TEXT,
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  is_mock      INTEGER NOT NULL DEFAULT 0 CHECK (is_mock IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_runs_week ON runs(week);

-- The raw answer one engine gave to one prompt during one run.
-- A failed call is still stored, with `error` set and `response_text` NULL.
CREATE TABLE IF NOT EXISTS responses (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  prompt_id      INTEGER NOT NULL REFERENCES prompts(id),
  engine_id      INTEGER NOT NULL REFERENCES engines(id),
  model          TEXT NOT NULL,
  response_text  TEXT,
  error          TEXT,
  latency_ms     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (run_id, prompt_id, engine_id)
);

-- A brand named in a response. `position` is 1 for the first brand named, 2 for the second, etc.
CREATE TABLE IF NOT EXISTS mentions (
  id             INTEGER PRIMARY KEY,
  response_id    INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  brand_id       INTEGER NOT NULL REFERENCES brands(id),
  position       INTEGER NOT NULL,
  char_offset    INTEGER NOT NULL,
  matched_alias  TEXT NOT NULL,
  UNIQUE (response_id, brand_id)
);

-- A source URL an engine cited. `brand_id` is set when the domain belongs to a tracked brand.
CREATE TABLE IF NOT EXISTS citations (
  id           INTEGER PRIMARY KEY,
  response_id  INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  domain       TEXT NOT NULL,
  title        TEXT,
  position     INTEGER NOT NULL,
  brand_id     INTEGER REFERENCES brands(id)
);
CREATE INDEX IF NOT EXISTS idx_citations_response ON citations(response_id);

-- Computed scores, one row per (week, engine, brand), built from the latest completed run of that week.
-- `engine_id` NULL means "all engines combined". Rows for a week are replaced wholesale on re-score.
CREATE TABLE IF NOT EXISTS weekly_scores (
  id              INTEGER PRIMARY KEY,
  week            TEXT NOT NULL,
  engine_id       INTEGER REFERENCES engines(id),
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  brand_id        INTEGER NOT NULL REFERENCES brands(id),
  responses       INTEGER NOT NULL,  -- successful answers to this category's prompts
  mention_count   INTEGER NOT NULL,  -- answers that named the brand
  mention_rate    REAL NOT NULL,     -- mention_count / responses
  avg_position    REAL,              -- mean `position` when named; NULL if never named
  prominence      REAL NOT NULL,     -- mean of 1/position over all answers (0 when not named)
  citation_count  INTEGER NOT NULL,  -- answers that cited the brand's own domain
  citation_rate   REAL NOT NULL,     -- citation_count / responses
  score           REAL NOT NULL,     -- 0–100 visibility score (see README)
  computed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_weekly_scores_week ON weekly_scores(week);
