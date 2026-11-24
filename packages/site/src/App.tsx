import { useEffect, useMemo, useState } from "react";
import {
  type IndexData,
  type Selection,
  brandHistory,
  loadIndex,
  pct,
  previousWeek,
  readSelection,
  scoresFor,
  writeSelection,
} from "./data";
import { Sparkline } from "./Sparkline";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: IndexData };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    loadIndex().then(
      (data) => setState({ status: "ready", data }),
      (err: unknown) => setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <h1>AI Search Visibility Index</h1>
        <p className="tagline">
          Which Canadian brands do ChatGPT, Perplexity and Gemini recommend? Measured weekly, with open data and an
          open methodology.
        </p>
      </header>
      {state.status === "loading" && <p className="muted">Loading…</p>}
      {state.status === "error" && <EmptyState detail={state.message} />}
      {state.status === "ready" &&
        (state.data.weeks.length === 0 ? <EmptyState detail="No weeks published yet." /> : <Dashboard data={state.data} />)}
      <footer className="footer">
        Open source. Scores reflect what AI engines said in answer to a fixed set of questions; they are not an
        endorsement or a measure of quality. Methodology is in the project README.
      </footer>
    </div>
  );
}

function Dashboard({ data }: { data: IndexData }) {
  const [sel, setSel] = useState<Selection>(() => readSelection(data));
  useEffect(() => writeSelection(sel), [sel]);

  const rows = useMemo(() => scoresFor(data, sel), [data, sel]);
  const prev = previousWeek(data, sel.week);
  const weekInfo = data.weeks.find((w) => w.week === sel.week);
  const category = data.categories.find((c) => c.slug === sel.category);
  const brandName = (slug: string) => data.brands.find((b) => b.slug === slug)?.name ?? slug;
  const sources = data.sources.filter(
    (s) => s.week === sel.week && s.engine === sel.engine && s.category === sel.category,
  );
  const answers = rows[0]?.responses ?? 0;
  const engine = data.engines.find((e) => e.slug === sel.engine);
  const noWeb = engine !== undefined && !engine.usesWeb;

  return (
    <main>
      {weekInfo?.isMock && (
        <div className="banner" role="note">
          Demo data: this week was generated with <code>--mock</code>, not real AI answers.
        </div>
      )}

      <div className="controls">
        <label>
          Week
          <select value={sel.week} onChange={(e) => setSel({ ...sel, week: e.target.value })}>
            {[...data.weeks].reverse().map((w) => (
              <option key={w.week} value={w.week}>
                {w.week}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Engine">
          {[{ slug: "all", name: "All engines" }, ...data.engines].map((e) => (
            <button
              key={e.slug}
              type="button"
              aria-pressed={sel.engine === e.slug}
              onClick={() => setSel({ ...sel, engine: e.slug })}
            >
              {e.name}
            </button>
          ))}
        </div>
      </div>

      <nav className="tabs" aria-label="Category">
        {data.categories.map((c) => (
          <button
            key={c.slug}
            type="button"
            aria-current={sel.category === c.slug}
            onClick={() => setSel({ ...sel, category: c.slug })}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <section className="card">
        <h2>
          {category?.name} leaderboard <span className="muted">· {answers} answers</span>
        </h2>
        {rows.length === 0 ? (
          <p className="muted">No answers from this engine for this category in {sel.week}.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Brand</th>
                  <th className="num">Score</th>
                  <th className="num">Change</th>
                  <th className="num" title="Share of answers that named the brand">Named in</th>
                  <th className="num" title="Average order in which the brand was named">Avg. position</th>
                  <th className="num" title="Share of answers citing the brand's own website">Own site cited</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const before = prev
                    ? data.scores.find((s) => s.week === prev && s.engine === sel.engine && s.brand === r.brand)
                    : undefined;
                  const delta = before ? r.score - before.score : null;
                  return (
                    <tr key={r.brand}>
                      <td className="num muted">{r.rank}</td>
                      <td>{brandName(r.brand)}</td>
                      <td className="num">
                        <span className="score">
                          <span className="bar" style={{ width: `${r.score}%` }} />
                          <strong>{r.score.toFixed(1)}</strong>
                        </span>
                      </td>
                      <td className={`num ${delta === null ? "muted" : delta > 0 ? "up" : delta < 0 ? "down" : "muted"}`}>
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                      </td>
                      <td className="num">{pct(r.mentionRate)}</td>
                      <td className="num">{r.avgPosition === null ? "—" : r.avgPosition.toFixed(1)}</td>
                      <td className="num">{noWeb ? <span className="muted">n/a</span> : pct(r.citationRate)}</td>
                      <td>
                        <Sparkline values={brandHistory(data, r.brand, sel.engine)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid">
        <section className="card">
          <h2>Most-cited sources</h2>
          {noWeb ? (
            <p className="muted">
              {engine.name} answers from what the model already knows, without searching the web, so it cites no
              sources. Its own-site citation score is always 0.
            </p>
          ) : sources.length === 0 ? (
            <p className="muted">No citations recorded.</p>
          ) : (
            <ol className="sources">
              {sources.map((s) => (
                <li key={s.domain}>
                  <span>
                    {s.domain}
                    {s.brand && <span className="tag">{brandName(s.brand)}</span>}
                  </span>
                  <span className="muted">
                    {s.answers} of {answers} answers
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card">
          <h2>Questions asked</h2>
          <ul className="prompts">
            {category?.prompts.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="muted small">
            Score = {data.weights.mention * 100}% named-in rate + {data.weights.prominence * 100}% prominence +{" "}
            {data.weights.citation * 100}% own-site citations, on a 0–100 scale.
          </p>
        </section>
      </div>

      <p className="muted small">
        Collected {weekInfo ? new Date(weekInfo.collectedAt).toLocaleDateString("en-CA") : "—"} · exported{" "}
        {new Date(data.generatedAt).toLocaleDateString("en-CA")}
      </p>
    </main>
  );
}

function EmptyState({ detail }: { detail: string }) {
  return (
    <section className="card">
      <h2>No data yet</h2>
      <p className="muted">{detail}</p>
      <p>Generate data with the collector, then reload:</p>
      <pre>
        <code>{"pnpm collect init\npnpm collect run --mock   # or with real API keys in .env\npnpm collect export"}</code>
      </pre>
    </section>
  );
}
