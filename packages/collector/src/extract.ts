import type { Citation } from "./engines/index.js";

export interface BrandMatcher {
  brandId: number;
  /** Brand name plus aliases, longest first. */
  terms: string[];
  domain: string | null;
}

export interface FoundMention {
  brandId: number;
  position: number;
  charOffset: number;
  matchedAlias: string;
}

export interface FoundCitation {
  url: string;
  domain: string;
  title: string | null;
  position: number;
  brandId: number | null;
}

/**
 * Find which brands an answer names, and in what order.
 * Matching is case-sensitive and whole-word ("TD" matches "TD Bank" but not "STDs").
 * Each brand counts once per answer, at its earliest mention.
 */
export function findMentions(text: string, brands: BrandMatcher[]): FoundMention[] {
  const hits: Omit<FoundMention, "position">[] = [];
  for (const brand of brands) {
    let best: { offset: number; term: string } | null = null;
    for (const term of brand.terms) {
      const m = wordRegex(term).exec(text);
      if (m && (best === null || m.index < best.offset)) best = { offset: m.index, term };
    }
    if (best) hits.push({ brandId: brand.brandId, charOffset: best.offset, matchedAlias: best.term });
  }
  hits.sort((a, b) => a.charOffset - b.charOffset);
  return hits.map((h, i) => ({ ...h, position: i + 1 }));
}

/** Normalize cited URLs to domains and link them to tracked brands' own sites. */
export function resolveCitations(citations: Citation[], brands: BrandMatcher[]): FoundCitation[] {
  const seen = new Set<string>();
  const out: FoundCitation[] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const domain = citationDomain(c);
    if (!domain) continue;
    const owner = brands.find((b) => b.domain && (domain === b.domain || domain.endsWith(`.${b.domain}`)));
    out.push({ url: c.url, domain, title: c.title, position: out.length + 1, brandId: owner?.brandId ?? null });
  }
  return out;
}

export function citationDomain(c: Citation): string | null {
  let host: string;
  try {
    host = new URL(c.url).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Gemini grounding links are redirects through Google; the real source domain is in the title.
  if (host === "vertexaisearch.cloud.google.com" && c.title && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.title.trim())) {
    host = c.title.trim().toLowerCase();
  }
  return host.replace(/^www\./, "");
}

function wordRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
}
