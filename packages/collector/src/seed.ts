import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.js";
import { ADAPTERS } from "./engines/index.js";
import { SEED_DIR } from "./paths.js";

interface SeedBrand {
  slug: string;
  name: string;
  domain: string | null;
  aliases: string[];
}

interface SeedCategory {
  slug: string;
  name: string;
  brands: SeedBrand[];
  prompts: string[];
}

interface SeedFile {
  categories: SeedCategory[];
}

export interface SeedSummary {
  categories: number;
  brands: number;
  activePrompts: number;
  retiredPrompts: number;
}

/**
 * Load seed/canada.json into the database. Safe to re-run: existing rows are updated,
 * and prompts that were removed from the file are marked inactive (never deleted).
 */
export function seed(db: DB, file = path.join(SEED_DIR, "canada.json")): SeedSummary {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as SeedFile;
  const summary: SeedSummary = { categories: 0, brands: 0, activePrompts: 0, retiredPrompts: 0 };

  const upsertEngine = db.prepare(
    "INSERT INTO engines (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name",
  );
  const upsertCategory = db.prepare(
    `INSERT INTO categories (slug, name) VALUES (?, ?)
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name RETURNING id`,
  );
  const upsertBrand = db.prepare(
    `INSERT INTO brands (category_id, slug, name, domain) VALUES (?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET category_id = excluded.category_id, name = excluded.name, domain = excluded.domain
     RETURNING id`,
  );
  const clearAliases = db.prepare("DELETE FROM brand_aliases WHERE brand_id = ?");
  const insertAlias = db.prepare("INSERT OR IGNORE INTO brand_aliases (brand_id, alias) VALUES (?, ?)");
  const upsertPrompt = db.prepare(
    `INSERT INTO prompts (category_id, text, active) VALUES (?, ?, 1)
     ON CONFLICT(category_id, text) DO UPDATE SET active = 1`,
  );
  const listPrompts = db.prepare<[number], { id: number; text: string }>(
    "SELECT id, text FROM prompts WHERE category_id = ? AND active = 1",
  );
  const retirePrompt = db.prepare("UPDATE prompts SET active = 0 WHERE id = ?");

  db.transaction(() => {
    for (const e of ADAPTERS) upsertEngine.run(e.slug, e.name);

    for (const cat of data.categories) {
      const { id: categoryId } = upsertCategory.get(cat.slug, cat.name) as { id: number };
      summary.categories++;

      for (const b of cat.brands) {
        const { id: brandId } = upsertBrand.get(categoryId, b.slug, b.name, b.domain) as { id: number };
        clearAliases.run(brandId);
        for (const alias of b.aliases) insertAlias.run(brandId, alias);
        summary.brands++;
      }

      const wanted = new Set(cat.prompts);
      for (const text of cat.prompts) upsertPrompt.run(categoryId, text);
      for (const p of listPrompts.all(categoryId)) {
        if (!wanted.has(p.text)) {
          retirePrompt.run(p.id);
          summary.retiredPrompts++;
        }
      }
      summary.activePrompts += wanted.size;
    }
  })();

  return summary;
}
