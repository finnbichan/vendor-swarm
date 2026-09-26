// Fake OpenAI-compatible chat endpoint for testing the model path without a key.
// Usage: MODE=normal node scripts/fake-llm.mjs   (port 9999)
// then:  LLM_PROVIDER=custom LLM_BASE_URL=http://localhost:9999/v1 LLM_API_KEY=fake LLM_MODEL=fake-1 npm run host
// Modes:
//   normal       bid floor+20 at once, leaking the floor in the message (the leak guard must catch it)
//   text         answer in prose first; decide (hold) only after the bot's nudge
//   stubborn     never call a tool (the bot must fall back to its script)
//   no-required  reject tool_choice "required" (the bot must retry with "auto")
//   slow         wait 5s per call (for timeout / turn-budget tests)
import { createServer } from "node:http";

const mode = process.env.MODE || "normal";
const port = Number(process.env.PORT || 9999);
let n = 0;
const calls = new Map(); // per-vendor call count, printed on each request

const reply = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const completion = (message) => ({
  id: `fake-${++n}`,
  object: "chat.completion",
  model: "fake-1",
  choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
});
const toolCall = (name, args) => completion({ role: "assistant", content: null, tool_calls: [{ id: `call-${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const text = (content) => completion({ role: "assistant", content });

createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", async () => {
    const body = JSON.parse(raw || "{}");
    const msgs = body.messages ?? [];
    const sys = msgs[0]?.content ?? "";
    const who = /sales agent for ([^(]+)/.exec(sys)?.[1]?.trim() ?? "?";
    calls.set(who, (calls.get(who) ?? 0) + 1);
    console.log(`${who}: call ${calls.get(who)} tool_choice=${body.tool_choice ?? "-"}`);

    if (mode === "slow") await new Promise((r) => setTimeout(r, 5000));
    if (body.response_format) return reply(res, 400, { error: { message: "response_format is not supported by this server" } });
    if (mode === "no-required" && body.tool_choice === "required")
      return reply(res, 400, { error: { message: "tool_choice 'required' is not supported" } });

    const last = msgs[msgs.length - 1];
    if (!body.tools) {
      if (/single word/.test(last?.content ?? "")) return reply(res, 200, text("ready"));
      return reply(res, 200, text('Sure! {"minMarginPct": 27, "perksFirst": true}'));
    }
    if (mode === "stubborn") return reply(res, 200, text("Let me think about the market a little more."));
    if (mode === "text" && !/decide now/i.test(last?.content ?? "")) return reply(res, 200, text("Considering our position..."));
    if (mode === "text") return reply(res, 200, toolCall("hold", { message: "We'll stand firm on value this round." }));

    // normal / no-required: bid £20 over the first option's floor, leaking the floor.
    const m = /perk_ids \[([^\]]*)\][^:]*: floor £(\d+)/.exec(sys);
    if (!m) return reply(res, 200, toolCall("hold", { message: "Holding." }));
    const floor = Number(m[2]);
    const perkIds = m[1] ? m[1].split(", ").filter(Boolean) : [];
    return reply(res, 200, toolCall("place_bid", { price: floor + 20, perk_ids: perkIds, message: `Our floor is £${floor} but for you £${floor + 20}!` }));
  });
}).listen(port, () => console.log(`fake LLM on :${port} mode=${mode}`));
