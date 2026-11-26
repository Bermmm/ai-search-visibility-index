import { fileURLToPath } from "node:url";
import path from "node:path";

// Compiled files live in packages/collector/dist, so the repo root is three levels up.
const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "../../..");
export const SCHEMA_PATH = path.join(REPO_ROOT, "docs/schema.sql");
export const SEED_DIR = path.resolve(here, "../seed");
export const DEFAULT_DB_PATH = path.join(REPO_ROOT, "data/index.db");
export const DEFAULT_EXPORT_DIR = path.join(REPO_ROOT, "packages/site/public/data");
export const ENV_PATH = path.join(REPO_ROOT, ".env");
