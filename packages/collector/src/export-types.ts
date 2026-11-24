// Shape of the JSON the collector exports and the site reads.
// The site imports these types directly, so this file is the single contract between the packages.
// It must stay dependency-free (no imports).

export interface IndexData {
  generatedAt: string;
  weights: { mention: number; prominence: number; citation: number };
  /** usesWeb is false for engines answering from model memory (no web search, so no citations). */
  engines: Array<{ slug: string; name: string; usesWeb: boolean }>;
  categories: Array<{ slug: string; name: string; prompts: string[] }>;
  brands: Array<{ slug: string; name: string; category: string; domain: string | null }>;
  weeks: WeekInfo[];
  scores: ScoreRow[];
  sources: SourceRow[];
}

export interface WeekInfo {
  week: string;
  runId: number;
  /** True when the run used fake answers (`--mock`), not real engines. */
  isMock: boolean;
  collectedAt: string;
}

/** `engine` is an engine slug, or "all" for every engine combined. */
export interface ScoreRow {
  week: string;
  engine: string;
  category: string;
  brand: string;
  rank: number;
  score: number;
  responses: number;
  mentionRate: number;
  avgPosition: number | null;
  prominence: number;
  citationRate: number;
}

/** Most-cited source domains per week, engine and category. */
export interface SourceRow {
  week: string;
  engine: string;
  category: string;
  domain: string;
  /** Number of answers citing this domain at least once. */
  answers: number;
  /** Brand slug when the domain is a tracked brand's own site. */
  brand: string | null;
}
