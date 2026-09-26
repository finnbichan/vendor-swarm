// Process-wide integration config. Every group is optional: blank means mock mode.
export const config = {
  llm: {
    defaultProvider: process.env.LLM_PROVIDER || "",
    defaultModel: process.env.LLM_MODEL || "",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 15_000),
    turnBudgetMs: Number(process.env.TURN_BUDGET_MS || 25_000),
    concurrency: Number(process.env.LLM_CONCURRENCY || 4),
  },
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || "2025-07",
  tavilyKey: process.env.TAVILY_API_KEY || "",
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  },
  swarmKey: process.env.SWARM_API_KEY || "",
  corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean),
  production: process.env.NODE_ENV === "production",
};

/* ------------------------------------------------------------------ */
/* LLM providers                                                        */
/* ------------------------------------------------------------------ */
// Any OpenAI-compatible endpoint. The operator fixes where each key may be sent;
// vendor owners only choose a provider id and a model, so a key can never be
// pointed at an arbitrary URL from the admin page.
type Preset = { baseURL: string; keyEnv: string; model: string };
export const PROVIDERS: Record<string, Preset> = {
  xai: { baseURL: process.env.XAI_BASE_URL || "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", model: process.env.XAI_MODEL || "grok-4.7" },
  openai: { baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", model: process.env.OPENAI_MODEL || "gpt-5-mini" },
  anthropic: { baseURL: "https://api.anthropic.com/v1/", keyEnv: "ANTHROPIC_API_KEY", model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5" },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL || "x-ai/grok-4.7" },
  together: { baseURL: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY", model: process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  // Operator-defined endpoint (e.g. a self-hosted vLLM/Ollama gateway).
  custom: { baseURL: process.env.LLM_BASE_URL || "", keyEnv: "LLM_API_KEY", model: process.env.LLM_MODEL || "" },
};
export const providerIds = Object.keys(PROVIDERS);

export type LlmTarget = { provider: string; baseURL: string; apiKey: string; model: string; temperature: number };

/** Default provider: LLM_PROVIDER, else the first preset that has a key (xai first). */
export function defaultProvider() {
  if (config.llm.defaultProvider && PROVIDERS[config.llm.defaultProvider]) return config.llm.defaultProvider;
  return providerIds.find((id) => process.env[PROVIDERS[id].keyEnv] && PROVIDERS[id].baseURL) ?? "xai";
}

/** Resolve a vendor's model settings to a callable target, or null if there's no usable key. */
export function llmTarget(sel?: { provider?: string; model?: string; temperature?: number }): LlmTarget | null {
  const provider = sel?.provider && PROVIDERS[sel.provider] ? sel.provider : defaultProvider();
  const p = PROVIDERS[provider];
  const apiKey = process.env[p.keyEnv] || "";
  const model = sel?.model || (provider === defaultProvider() && config.llm.defaultModel) || p.model;
  if (!apiKey || !p.baseURL || !model) return null;
  return { provider, baseURL: p.baseURL, apiKey, model, temperature: sel?.temperature ?? 0.6 };
}

/** Which providers have a key configured - safe to show owners (no key values). */
export const providerStatus = () =>
  providerIds.map((id) => ({ id, keyEnv: PROVIDERS[id].keyEnv, configured: !!(process.env[PROVIDERS[id].keyEnv] && PROVIDERS[id].baseURL), defaultModel: PROVIDERS[id].model }));

export const live = {
  llm: () => llmTarget() !== null,
  tavily: () => !!config.tavilyKey,
  supabaseAuth: () => !!(config.supabase.url && config.supabase.anonKey),
  supabaseStorage: () => process.env.CONFIG_STORAGE !== "file" && !!(config.supabase.url && config.supabase.serviceKey),
};
