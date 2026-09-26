// Refuse to boot a production deployment with demo-grade secrets.
import { config, live } from "../lib/config";
import { envPrefix } from "./auth";

export function productionProblems(vendorIds: string[]): string[] {
  if (!config.production) return [];
  const problems: string[] = [];
  if (!process.env.ADMIN_SESSION_SECRET) problems.push("ADMIN_SESSION_SECRET is not set (admin sessions would die on every restart).");
  if (!config.swarmKey) problems.push("SWARM_API_KEY is not set (anyone could request quotes and mint discount codes).");
  if (!live.supabaseAuth()) {
    const missing = vendorIds.filter((id) => !process.env[`${envPrefix(id)}_ADMIN_PASSWORD`]).map((id) => `${envPrefix(id)}_ADMIN_PASSWORD`);
    if (missing.length) problems.push(`Supabase Auth isn't configured and these vendors would use the demo password: ${missing.join(", ")}.`);
  }
  return problems;
}

export function assertProductionReady(vendorIds: string[]) {
  const problems = productionProblems(vendorIds);
  if (!problems.length) return;
  console.error("Refusing to start in production:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
