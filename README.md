# AI Search Visibility Index — Canada

An open, weekly index of which brands and websites **ChatGPT, Perplexity and Gemini** recommend when Canadians ask everyday questions. The questions, the code, the scoring formula and the published data are all public.

> Status: early. The pipeline works end to end, and real weekly runs start once API keys are added.

---

## How it works, in plain English

**1. We ask the same questions every week.**
Each category (Banking, Mobile & Internet, Grocery, Airlines, Insurance) has a short list of questions a Canadian consumer might type into an AI assistant, such as *"Which Canadian bank has the lowest monthly fees?"* The questions never name a brand. They live in [`packages/collector/seed/canada.json`](packages/collector/seed/canada.json).

**2. We ask each AI engine, from Canada.**
Every question goes to ChatGPT (OpenAI), Perplexity and Gemini (Google) with web search turned on, and each request says the user is in Canada. We save each full answer and the list of websites it cites.

**3. We note which brands each answer names, and in what order.**
Every brand has a name and a few aliases (for example, "RBC" or "Royal Bank of Canada"). An answer "names" a brand if it contains one of those names as a whole word, with matching capitals. That way "TD" counts but the "td" inside "STDs" doesn't. A brand counts once per answer, at its first appearance: the first brand named is position 1, the second is position 2, and so on.

**4. We note when an answer cites a brand's own website.**
If an answer links to `rbc.com` (or a subdomain of it), that counts as an *own-site citation* for RBC. We also publish the most-cited websites overall, which are often review and comparison sites rather than the brands themselves.

**5. We turn that into a 0–100 score per brand, per week.**

| Part | Weight | Meaning |
|---|---|---|
| **Named-in rate** | 60% | Share of the category's answers that name the brand at all. |
| **Prominence** | 20% | Rewards being named early. Named first = 1 point, second = ½, third = ⅓ … not named = 0, averaged over all answers. |
| **Own-site citations** | 20% | Share of answers that cite the brand's own website as a source. |

```
score = 100 × (0.6 × named-in rate + 0.2 × prominence + 0.2 × own-site citation rate)
```

A brand named first in every answer, with its own site cited every time, scores 100. A brand never mentioned scores 0. Scores are calculated for each engine separately and for all engines combined.

**6. We publish only aggregates.**
Raw answers stay in the local database. The website shows scores, ranks, week-over-week changes and the most-cited domains.

### What the index is not

- **Not a quality ranking.** It measures what AI engines *said*, not which bank or carrier is actually best.
- **Not every possible question.** A small, fixed set of questions keeps weeks comparable, but it can't cover everything people ask.
- **Not perfectly stable.** AI answers vary from one request to the next. Each question is asked once per engine per week, so expect some week-to-week noise. Trends over several weeks are more meaningful than any single week.

### Rules we keep

- **Questions never name brands**, so we don't lead the answer.
- **Questions are never edited in place.** To change one, we retire it and add a new one, so we always know exactly what was asked in a given week.
- **Each week uses one run.** If a week is re-run, the latest complete run replaces the earlier one.
- **Demo data is labelled.** Runs made with `--mock` (fake answers, used for testing) are flagged, and the site shows a "Demo data" banner for those weeks.

### Known limitations

- Name matching is literal. A brand mentioned in an unusual way (a misspelling, or a French name we haven't listed as an alias) is missed. A common word that is also a brand name, such as "Metro" or "Bell" at the start of a sentence, can be over-counted. Aliases are tuned in the seed file.
- Gemini's citation links pass through Google redirects. We use the source title Google provides to recover the real domain.
- Results depend on the model version each provider serves that week. The exact model is stored with every answer.

---

## Repository layout

```
docs/schema.sql          SQLite schema (source of truth)
packages/collector/      Node 20 CLI: asks the questions, stores answers, computes scores, exports JSON
  seed/canada.json       Categories, brands, aliases, domains and questions
  src/engines/           One small file per AI engine (plain fetch, no SDKs)
packages/site/           Static Vite + React dashboard that reads index.json
```

Database tables: `categories`, `brands`, `brand_aliases`, `prompts`, `engines`, `runs`, `responses`, `mentions`, `citations`, `weekly_scores`. See [`docs/schema.sql`](docs/schema.sql) for column-by-column notes.

## Running it

Requires Node 20.19+ and pnpm 10.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Add whichever API keys you have to `.env`. Engines without a key are skipped. `.env` is git-ignored, so never commit real keys.

```bash
pnpm collect init
```

```bash
pnpm collect run
```

```bash
pnpm collect export
```

```bash
pnpm dev
```

- `init` creates `data/index.db` from `docs/schema.sql` and loads the seed file. Re-run it after editing the seed.
- `run` asks every active question to every engine for the current ISO week, then scores the week.
- `export` writes `packages/site/public/data/index.json`, the only file the site reads.
- `dev` starts the dashboard at http://localhost:5173.

To try the whole pipeline without keys or cost, use fake answers:

```bash
pnpm collect run --mock
```

More options:

```
pnpm collect run --engines perplexity --limit 2   # cheap smoke test: one engine, two questions
pnpm collect run --week 2026-W48                  # run or re-run a specific ISO week
pnpm collect score --week 2026-W48                # recompute scores without new API calls
pnpm collect status                               # recent runs and error counts
```

Model choices can be overridden in `.env` with `OPENAI_MODEL`, `PERPLEXITY_MODEL` or `GEMINI_MODEL`.

### Publishing a week

1. `pnpm collect run` and then `pnpm collect export`.
2. Commit `packages/site/public/data/index.json`.
3. `pnpm build` and deploy `packages/site/dist/` to any static host.

## License

MIT. See [LICENSE](LICENSE).
