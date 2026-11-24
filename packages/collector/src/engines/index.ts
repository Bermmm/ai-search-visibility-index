import { gemini } from "./gemini.js";
import { openai } from "./openai.js";
import { perplexity } from "./perplexity.js";
import type { Engine } from "./types.js";

export const ENGINES: readonly Engine[] = [openai, perplexity, gemini];

export type { Engine, EngineAnswer, EngineCitation } from "./types.js";
