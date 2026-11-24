# AI Search Visibility Index — Canada

An open, weekly index of which brands and websites **ChatGPT, Perplexity and Gemini** recommend when Canadians ask everyday questions. The questions, the code, the scoring formula and the published data are all public.

> Status: early. The pipeline works end to end, and real weekly runs start once API keys are added.

---

## How it works, in plain English

**1. We ask the same questions every week.**
Each category (Banking, Mobile & Internet, Grocery, Airlines, Insurance) has a short list of questions a Canadian consumer might type into an AI assistant, such as *"Which Canadian bank has the lowest monthly fees?"* The questions never name a brand. They live in [`packages/collector/seed/canada.json`](packages/collector/seed/canada.json).

**2. We ask each AI engine, from Canada, more than once.**
Every question goes to three engines. Each request says the user is in Canada.

| Engine | Model | Web search? |
|---|---|---|
| ChatGPT (OpenAI) | `gpt-5-mini` | Yes: OpenAI's web search tool, located in Canada |
| Perplexity | `perplexity/sonar` | Yes: Perplexity's web search tool, located in Canada |
| Gemini (model memory, no web) | `gemini-3.5-flash-lite` | **No.** Google's terms for search grounding don't allow storing or analyzing grounded answers, so we ask Gemini without it. Its answers reflect what the model learned in training, and it never cites sources. |

AI answers vary, so each question is asked to each engine **twice a week** by default. Every request is fresh: no chat history, nothing carried over from the previous question. We save each full answer and the websites it cites.

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

A brand named first in every answer, with its own site cited every time, scores 100. A brand never mentioned scores 0. Scores are calculated for each engine separately and for all engines combined, counting every sample as one answer.

Because Gemini cites nothing, a brand's Gemini-only score tops out at 80, and in the all-engines score the citation part comes only from ChatGPT and Perplexity answers.

**6. We publish only aggregates.**
Raw answers stay in the local database. The website shows scores, ranks, week-over-week changes and the most-cited domains.

### What the index is not

- **Not a quality ranking.** It measures what AI engines *said*, not which bank or carrier is actually best.
- **Not every possible question.** A small, fixed set of questions keeps weeks comparable, but it can't cover everything people ask.
- **Not perfectly stable.** AI answers vary from one request to the next. Asking twice helps, but expect some week-to-week noise. Trends over several weeks are more meaningful than any single week.

### Rules we keep

- **Questions never name brands**, so we don't lead the answer.
- **Questions are never edited in place.** To change one, we retire it and add a new one, so we always know exactly what was asked in a given week.
- **Each week uses one complete run.** If a week is re-run, the latest complete run replaces the earlier one. A run cut short (for example by the budget cap) is never scored.
- **Every call is logged.** For each API call we store the exact model id served, the UTC time, latency, retries, token usage and cost.
- **Spending is capped.** A hard monthly budget stops a run before it can overspend.
- **Demo data is labelled.** Runs made with `--mock` (fake answers, used for testing) are flagged, never replace a real run, and the site shows a "Demo data" banner for those weeks.

### Known limitations

- Name matching is literal. A brand mentioned in an unusual way (a misspelling, or a French name we haven't listed as an alias) is missed. A common word that is also a brand name, such as "Metro" or "Bell" at the start of a sentence, can be over-counted. Aliases are tuned in the seed file.
- Gemini is measured without web access, so it isn't a like-for-like comparison with the two search engines. It shows what a model "remembers", which is useful in its own right, but it is labelled separately for that reason.
- Perplexity marks sources with [1], [2] … pointing at its search results. We count the results the answer actually references, or all of them if it references none.
- Results depend on the model version each provider serves that week. The exact model is stored with every answer.

---

## Repository layout

```
docs/schema.sql          SQLite schema (source of truth)
packages/collector/      Node 20 CLI: asks the questions, stores answers, computes scores, exports JSON
  seed/canada.json       Categories, brands, aliases, domains and questions
  src/engines/           One adapter per AI engine (plain fetch, no SDKs), all behind
                         one interface: run(prompt) → { text, citations[], model, raw, usage }
  src/pricing.ts         Per-model prices used to compute cost per call
  src/budget.ts          The monthly budget cap
  src/retry.ts           Retry with exponential backoff (429s, 5xx, timeouts, dropped connections)
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

Add whichever API keys you have to `.env`, and set `BUDGET_USD`, the hard monthly spending cap that real runs require. Engines without a key are skipped. `.env` is git-ignored, so never commit real keys.

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
- `run` asks every active question to every engine (twice, by default) for the current ISO week, then scores the week.
- `export` writes `packages/site/public/data/index.json`, the only file the site reads.
- `dev` starts the dashboard at http://localhost:5173.

To try the whole pipeline without keys or cost, use fake answers:

```bash
pnpm collect run --mock
```

More options:

```
pnpm collect run --dry-run                        # show calls, models and estimated cost; call nothing
pnpm collect run --limit 2 --samples 1            # cheap trial: first two questions, asked once
pnpm collect run --engines perplexity --limit 2   # one engine only
pnpm collect run --week 2026-W48                  # run or re-run a specific ISO week
pnpm collect score --week 2026-W48                # recompute scores without new API calls
pnpm collect status                               # this month's spend, recent runs and error counts
```

### Cost and the budget cap

The cost of every call is worked out from the token usage the provider reports and the prices in `packages/collector/src/pricing.ts`. Perplexity reports its own dollar figure, and we use that directly. Before each call, the collector sets aside a conservative estimate of what the call could cost. If that would take this month's (UTC) spend past `BUDGET_USD`, the run stops: calls already in progress finish, nothing new starts, and the incomplete run is marked `stopped` and never scored. Failed calls are retried up to 3 times with exponential backoff, honouring the provider's `Retry-After` header.

A full default run is 20 questions × 3 engines × 2 samples = 120 calls. `--dry-run` shows the estimate before you spend anything.

Model choices can be overridden in `.env` with `OPENAI_MODEL`, `PERPLEXITY_MODEL` or `GEMINI_MODEL`. Add any new model's prices to `pricing.ts`.

> **Upgrading from an earlier checkout:** the database schema changed (version 2). Move the old `data/index.db` aside and run `pnpm collect init`.

### Publishing a week

1. `pnpm collect run` and then `pnpm collect export`.
2. Commit `packages/site/public/data/index.json`.
3. `pnpm build` and deploy `packages/site/dist/` to any static host.

## License

MIT. See [LICENSE](LICENSE).
