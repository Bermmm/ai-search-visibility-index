import { gemini } from "./gemini.js";
import { openai } from "./openai.js";
import { perplexity } from "./perplexity.js";
import type { AdapterSpec } from "./types.js";

export const ADAPTERS: readonly AdapterSpec[] = [openai, perplexity, gemini];

export type { Adapter, AdapterSpec, Citation, RunResult, Usage } from "./types.js";
