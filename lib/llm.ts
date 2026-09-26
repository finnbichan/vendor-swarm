import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { config, type LlmTarget } from "./config";
import type { Emit } from "./events";

/* ---------------- clients, one per endpoint+key ---------------- */
const clients = new Map<string, OpenAI>();
function client(t: LlmTarget) {
  const key = `${t.baseURL}|${t.apiKey}`;
  let c = clients.get(key);
  // The SDK retries 429/5xx with backoff; one retry keeps a round snappy.
  if (!c) clients.set(key, (c = new OpenAI({ apiKey: t.apiKey, baseURL: t.baseURL, timeout: config.llm.timeoutMs, maxRetries: 1 })));
  return c;
}

/* ---------------- per-provider concurrency limit ---------------- */
// Eight bots in one process all think at once each round; cap in-flight calls per provider.
const gates = new Map<string, { active: number; queue: (() => void)[] }>();
async function limited<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  let g = gates.get(provider);
  if (!g) gates.set(provider, (g = { active: 0, queue: [] }));
  if (g.active >= config.llm.concurrency) await new Promise<void>((r) => g!.queue.push(r));
  g.active++;
  try {
    return await fn();
  } finally {
    g.active--;
    g.queue.shift()?.();
  }
}

type CreateParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">;

// Params a model has rejected before (e.g. gpt-5 models only accept the default temperature).
const unsupported = new Map<string, Set<string>>();
const OPTIONAL_PARAMS = ["temperature", "max_tokens"] as const;

async function chat(t: LlmTarget, who: string, params: CreateParams, signal?: AbortSignal) {
  const started = Date.now();
  const key = `${t.provider}:${t.model}`;
  const call = () => {
    const p: Record<string, unknown> = { ...params, model: t.model };
    for (const k of unsupported.get(key) ?? []) delete p[k];
    return client(t).chat.completions.create(p as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal });
  };
  const res = await limited(t.provider, async () => {
    try {
      return await call();
    } catch (e) {
      const bad = e instanceof OpenAI.BadRequestError ? OPTIONAL_PARAMS.filter((k) => k in params && e.message.includes(k)) : [];
      if (!bad.length) throw e;
      unsupported.set(key, new Set([...(unsupported.get(key) ?? []), ...bad]));
      return await call();
    }
  });
  const u = res.usage;
  console.log(`[${who}] llm ${t.provider}:${t.model} ${u ? `${u.prompt_tokens}+${u.completion_tokens} tok ` : ""}${((Date.now() - started) / 1000).toFixed(1)}s`);
  return res;
}

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * The agent loop: send messages + tool list to the model, run any tools it calls,
 * feed results back, repeat until it answers in plain text.
 */
export async function runAgent(opts: {
  target: LlmTarget;
  agent: string;
  system: string;
  messages: ChatCompletionMessageParam[];
  tools: ToolDef[];
  emit: Emit;
  maxSteps?: number;
  stopAfterTools?: string[]; // end the loop right after one of these tools succeeds
  signal?: AbortSignal;
}): Promise<{ text: string; messages: ChatCompletionMessageParam[]; stoppedBy?: string }> {
  const { agent, system, tools, emit } = opts;
  const messages = [...opts.messages];
  const toolSpec: ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    opts.signal?.throwIfAborted();
    const res = await chat(
      opts.target,
      agent,
      { messages: [{ role: "system", content: system }, ...messages], tools: toolSpec, tool_choice: "auto", temperature: opts.target.temperature },
      opts.signal,
    );
    const msg = res.choices[0].message;
    messages.push(msg as ChatCompletionMessageParam);

    if (!msg.tool_calls?.length) return { text: (msg.content ?? "").trim(), messages };

    let stoppedBy: string | undefined;
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const tool = tools.find((t) => t.name === call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      const started = Date.now();
      let result: unknown;
      try {
        result = tool ? await tool.run(args) : { error: `Unknown tool ${call.function.name}` };
      } catch (e) {
        result = { error: (e as Error).message };
      }
      emit({ t: "tool", agent, name: call.function.name, args, result, ms: Date.now() - started });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      const ok = !(result && typeof result === "object" && "error" in (result as object));
      if (ok && opts.stopAfterTools?.includes(call.function.name)) stoppedBy = call.function.name;
    }
    if (stoppedBy) return { text: "", messages, stoppedBy };
  }
  return { text: "", messages };
}

/** Pull the first JSON object out of a reply (for providers without JSON mode). */
function extractJSON(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

/** Plain JSON completion (used to parse the merchant's plain-English policy). */
export async function completeJSON(target: LlmTarget, who: string, system: string, user: string): Promise<unknown> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  try {
    const res = await chat(target, who, { messages, response_format: { type: "json_object" }, temperature: 0 });
    return extractJSON(res.choices[0].message.content || "{}");
  } catch (e) {
    // Some OpenAI-compatible servers reject response_format - ask for JSON in the prompt instead.
    if (!(e instanceof OpenAI.BadRequestError)) throw e;
    const res = await chat(target, who, {
      messages: [{ role: "system", content: `${system}\nReply with a single JSON object and nothing else.` }, messages[1]],
      temperature: 0,
    });
    return extractJSON(res.choices[0].message.content || "");
  }
}

/** One tiny call to check a provider/model works. Used by the admin "Test model" button. */
export async function pingModel(target: LlmTarget, who: string) {
  const started = Date.now();
  const res = await chat(target, who, { messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 5, temperature: 0 });
  return { ok: true, model: res.model || target.model, reply: (res.choices[0].message.content ?? "").trim().slice(0, 40), ms: Date.now() - started };
}
