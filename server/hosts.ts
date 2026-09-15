import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { paseoHome } from "./paseo-home";

export type KanbanHostConfig = { name: string; host: string };

const file = join(paseoHome(), "plugin-data", "paseo-kanban", "hosts.json");

export function readHosts(): KanbanHostConfig[] {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid kanban host registry at ${file}: expected an object.`);
    }
    const entries = Object.entries(value);
    if (entries.length > 20) throw new Error(`Invalid kanban host registry at ${file}: maximum 20 hosts.`);
    return entries.map(([name, host]) => {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name === "local" || typeof host !== "string" || !host.trim()) {
        throw new Error(`Invalid kanban host registry entry '${name}' at ${file}.`);
      }
      return { name, host };
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function writeHosts(hosts: KanbanHostConfig[]): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(Object.fromEntries(hosts.map(({ name, host }) => [name, host])), null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temp, file);
}

export function addHost(input: KanbanHostConfig): KanbanHostConfig[] {
  const hosts = readHosts();
  if (hosts.some(({ name }) => name === input.name)) throw new Error(`Host '${input.name}' already exists.`);
  hosts.push(input);
  writeHosts(hosts);
  return hosts;
}

export function removeHost(name: string): KanbanHostConfig[] {
  const hosts = readHosts();
  if (!hosts.some((host) => host.name === name)) throw new Error(`Host '${name}' does not exist.`);
  const next = hosts.filter((host) => host.name !== name);
  writeHosts(next);
  return next;
}
