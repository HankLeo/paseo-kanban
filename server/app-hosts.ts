import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppHostConnection } from "../shared/contracts";
import { paseoHome } from "./paseo-home";

/**
 * Hosts mirrored from the Paseo app's own registry via the client bundle. Kept separate from the
 * manually managed hosts.json: this file is fully replaced on every sync and the app registry is
 * the source of truth. Contains connection material, so it is written owner-only like hosts.json.
 */

export interface AppHostRecord {
  name: string;
  host: string;
  serverId: string;
}

export interface AppHostSyncInputEntry {
  serverId: string;
  label?: string;
  connection?: AppHostConnection;
}

const file = join(paseoHome(), "plugin-data", "paseo-kanban", "app-hosts.json");
const localNameFile = join(paseoHome(), "plugin-data", "paseo-kanban", "local-host.json");
const MAX_HOSTS = 20;

export function appHostConnectionString(connection: AppHostConnection, serverId: string): string {
  if (connection.type === "directTcp") {
    const params = new URLSearchParams();
    if (connection.useTls) params.set("ssl", "true");
    if (connection.password) params.set("password", connection.password);
    const query = params.toString();
    return `tcp://${connection.endpoint}${query ? `?${query}` : ""}`;
  }
  const offer = Buffer.from(
    JSON.stringify({
      serverId,
      daemonPublicKeyB64: connection.daemonPublicKeyB64,
      relay: { endpoint: connection.relayEndpoint, ...(connection.useTls !== undefined ? { useTls: connection.useTls } : {}) },
    }),
  ).toString("base64url");
  return `https://app.paseo.sh/#offer=${offer}`;
}

function sanitizeName(label: string | undefined, serverId: string): string {
  const base = (label ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (base.length > 0) return base;
  return `host-${createHash("sha256").update(serverId).digest("hex").slice(0, 8)}`;
}

export function toAppHostRecords(
  entries: readonly AppHostSyncInputEntry[],
  options: { localServerId?: string; reservedNames?: ReadonlySet<string> } = {},
): AppHostRecord[] {
  const reserved = new Set(options.reservedNames ?? []);
  const used = new Set<string>(reserved);
  const records: AppHostRecord[] = [];
  for (const entry of entries.slice(0, MAX_HOSTS)) {
    if (options.localServerId && entry.serverId === options.localServerId) continue;
    if (!entry.connection) continue;
    let name = sanitizeName(entry.label, entry.serverId);
    if (used.has(name)) {
      const suffix = createHash("sha256").update(entry.serverId).digest("hex").slice(0, 6);
      name = `${name.slice(0, 60)}-${suffix}`;
    }
    if (used.has(name)) continue;
    used.add(name);
    records.push({
      name,
      host: appHostConnectionString(entry.connection, entry.serverId),
      serverId: entry.serverId,
    });
  }
  return records;
}

export function readAppHosts(): AppHostRecord[] {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(value)) return [];
    const records: AppHostRecord[] = [];
    for (const candidate of value) {
      if (!candidate || typeof candidate !== "object") continue;
      const record = candidate as { name?: unknown; host?: unknown; serverId?: unknown };
      if (typeof record.name === "string" && typeof record.host === "string" && typeof record.serverId === "string") {
        records.push({ name: record.name, host: record.host, serverId: record.serverId });
      }
    }
    return records;
  } catch {
    return [];
  }
}

/** Persist the app-registry label of the local daemon so the board names it like any other host. */
function writeLocalHostName(entries: readonly AppHostSyncInputEntry[], localServerId: string | undefined): boolean {
  if (!localServerId) return false;
  const local = entries.find((entry) => entry.serverId === localServerId);
  if (!local) {
    try {
      rmSync(localNameFile);
      return true;
    } catch {
      return false;
    }
  }
  const name = sanitizeName(local.label, local.serverId);
  const serialized = `${JSON.stringify({ serverId: localServerId, name }, null, 2)}\n`;
  let previous = "";
  try {
    previous = readFileSync(localNameFile, "utf8");
  } catch {
    // First sync.
  }
  if (previous === serialized) return false;
  mkdirSync(dirname(localNameFile), { recursive: true, mode: 0o700 });
  const temp = `${localNameFile}.tmp`;
  writeFileSync(temp, serialized, { mode: 0o600 });
  renameSync(temp, localNameFile);
  return true;
}

/** The app-registry label of the local daemon, null when no app has mirrored one yet. */
export function readLocalHostName(): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(localNameFile, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as { name?: unknown };
    return typeof record.name === "string" && record.name.length > 0 ? record.name : null;
  } catch {
    return null;
  }
}

/** Replace the mirror; returns how many hosts landed and whether the file changed. */
export function writeAppHosts(
  entries: readonly AppHostSyncInputEntry[],
  options: { localServerId?: string; reservedNames?: ReadonlySet<string> } = {},
): { synced: number; changed: boolean } {
  const localNameChanged = writeLocalHostName(entries, options.localServerId);
  const records = toAppHostRecords(entries, options);
  const serialized = `${JSON.stringify(records, null, 2)}\n`;
  let previous = "";
  try {
    previous = readFileSync(file, "utf8");
  } catch {
    // First sync.
  }
  if (previous === serialized) return { synced: records.length, changed: localNameChanged };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  writeFileSync(temp, serialized, { mode: 0o600 });
  renameSync(temp, file);
  return { synced: records.length, changed: true };
}

/** Look up one host by display name across the app-mirrored registry. */
export function findAppHost(name: string): AppHostRecord | null {
  return readAppHosts().find((record) => record.name === name) ?? null;
}
