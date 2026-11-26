import type { IndexData, ScoreRow } from "../../collector/src/export-types";

export type { IndexData, ScoreRow, SourceRow, WeekInfo } from "../../collector/src/export-types";

export async function loadIndex(): Promise<IndexData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/index.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`index.json not found (HTTP ${res.status})`);
  return (await res.json()) as IndexData;
}

export interface Selection {
  week: string;
  engine: string;
  category: string;
}

/** Read the selection from the URL (?week=&engine=&category=) so views are shareable. */
export function readSelection(data: IndexData): Selection {
  const q = new URLSearchParams(window.location.search);
  const weeks = data.weeks.map((w) => w.week);
  const week = q.get("week");
  const engine = q.get("engine");
  const category = q.get("category");
  return {
    week: week && weeks.includes(week) ? week : (weeks.at(-1) ?? ""),
    engine: engine && (engine === "all" || data.engines.some((e) => e.slug === engine)) ? engine : "all",
    category:
      category && data.categories.some((c) => c.slug === category) ? category : (data.categories[0]?.slug ?? ""),
  };
}

export function writeSelection(s: Selection): void {
  const q = new URLSearchParams({ week: s.week, engine: s.engine, category: s.category });
  window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
}

/** Scores for one brand across every published week, oldest first. */
export function brandHistory(data: IndexData, brand: string, engine: string): Array<number | null> {
  return data.weeks.map(
    (w) => data.scores.find((s) => s.week === w.week && s.engine === engine && s.brand === brand)?.score ?? null,
  );
}

export function previousWeek(data: IndexData, week: string): string | null {
  const i = data.weeks.findIndex((w) => w.week === week);
  return i > 0 ? data.weeks[i - 1]!.week : null;
}

export function scoresFor(data: IndexData, s: Selection): ScoreRow[] {
  return data.scores
    .filter((r) => r.week === s.week && r.engine === s.engine && r.category === s.category)
    .sort((a, b) => a.rank - b.rank);
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
