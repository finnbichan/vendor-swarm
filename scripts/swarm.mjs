// Starts every vendor bot as its own process with prefixed, coloured logs. Ctrl-C stops them all.
// Usage: npm run swarm [-- aurora soundhaus]   (no ids = all vendors in vendors/index.json)
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const all = JSON.parse(readFileSync(`${root}vendors/index.json`, "utf8"));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
const unknown = ids.filter((id) => !all.includes(id));
if (unknown.length) {
  console.error(`Unknown vendor(s): ${unknown.join(", ")}. Known: ${all.join(", ")}`);
  process.exit(1);
}

const colours = [35, 33, 32, 31, 36, 34, 96, 92];
const width = Math.max(...ids.map((id) => id.length));
const tsx = `${root}node_modules/.bin/tsx`;
const envFlag = existsSync(`${root}.env`) ? ["--env-file=.env"] : [];
const children = new Map();
let stopping = false;

function prefix(id) {
  const c = colours[all.indexOf(id) % colours.length];
  return `\x1b[${c}m${id.padEnd(width)}\x1b[0m │ `;
}

function pipe(stream, id, out) {
  let buf = "";
  stream.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) out.write(prefix(id) + l.replace(new RegExp(`^\\[${id}\\] `), "") + "\n");
  });
}

for (const id of ids) {
  const child = spawn(tsx, [...envFlag, "bot/server.ts", "--vendor", id], { cwd: root, env: { ...process.env, FORCE_COLOR: "1" } });
  children.set(id, child);
  pipe(child.stdout, id, process.stdout);
  pipe(child.stderr, id, process.stderr);
  child.on("exit", (code, signal) => {
    children.delete(id);
    if (!stopping) console.log(`${prefix(id)}\x1b[31mexited (${signal ?? code})\x1b[0m`);
    if (stopping && children.size === 0) process.exit(0);
  });
}
console.log(`Starting ${ids.length} vendor bots… Ctrl-C to stop.`);

function stop() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping swarm…");
  for (const c of children.values()) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000).unref();
  if (children.size === 0) process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
