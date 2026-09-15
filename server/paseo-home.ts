import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Resolve the same PASEO_HOME used by the daemon, including an unexpanded leading `~`. */
export function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
