import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppHostConnection } from "../shared/contracts";
import { paseoHome } from "./paseo-home";

/**
 * Hosts mirrored from the Paseo app's own registry via the client bundle. Kept separate from the
 * manually managed hosts.json: each syncing app instance owns one partition and replaces only its
 * own records (see mergeAppHostRecords), so several machines' apps coexist. Contains connection
 * material, so it is written owner-only like hosts.json.
 */

export interface AppHostRecord {
  /** Owning app instance (storage-scoped id); "" marks records from pre-partition plugin versions. */
  appId: string;
  name: string;
  host: string;
  serverId: string;
  /** ISO time of the last sync that changed this record; informational, kept stable while unchanged. */
  syncedAt: string;
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
  options: { appId?: string; localServerId?: string; reservedNames?: ReadonlySet<string>; now?: string } = {},
): AppHostRecord[] {
  const appId = options.appId ?? "";
  const syncedAt = options.now ?? new Date().toISOString();
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
      appId,
      name,
      host: appHostConnectionString(entry.connection, entry.serverId),
      serverId: entry.serverId,
      syncedAt,
    });
  }
  return records;
}

/**
 * One app instance only replaces the partition it owns, so several machines mirroring their own
 * registries into the same daemon coexist instead of clobbering each other. When two apps mirror
 * the same daemon, the current owner's record stays stable until that owner stops listing it.
 * Records without an appId come from pre-partition versions and are dropped by the first
 * partitioned sync.
 */
export function mergeAppHostRecords(
  previous: readonly AppHostRecord[],
  incoming: readonly AppHostRecord[],
  appId: string,
  reservedNames: ReadonlySet<string>,
): AppHostRecord[] {
  const kept = appId
    ? previous.filter((record) => record.appId !== "" && record.appId !== appId)
    : previous.filter((record) => record.appId === "");
  const byServerId = new Map(kept.map((record) => [record.serverId, record]));
  const ownPrevious = new Map(
    previous.filter((record) => record.appId === appId).map((record) => [record.serverId, record] as const),
  );
  for (const record of incoming) {
    if (byServerId.has(record.serverId)) continue;
    // Keep the stored timestamp while the connection is unchanged so idle syncs stay no-ops.
    const unchanged = ownPrevious.get(record.serverId);
    byServerId.set(
      record.serverId,
      unchanged && unchanged.host === record.host ? { ...record, syncedAt: unchanged.syncedAt } : record,
    );
  }
  return dedupeNames([...byServerId.values()], reservedNames);
}

function dedupeNames(records: readonly AppHostRecord[], reservedNames: ReadonlySet<string>): AppHostRecord[] {
  const used = new Set<string>(reservedNames);
  const result: AppHostRecord[] = [];
  for (const record of [...records].sort((a, b) => a.serverId.localeCompare(b.serverId))) {
    let name = record.name;
    if (used.has(name)) {
      const suffix = createHash("sha256").update(record.serverId).digest("hex").slice(0, 6);
      name = `${record.name.slice(0, 60)}-${suffix}`;
    }
    if (used.has(name)) continue;
    used.add(name);
    result.push(name === record.name ? record : { ...record, name });
  }
  return result.slice(0, MAX_HOSTS);
}

export function readAppHosts(): AppHostRecord[] {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(value)) return [];
    const records: AppHostRecord[] = [];
    for (const candidate of value) {
      if (!candidate || typeof candidate !== "object") continue;
      const record = candidate as { appId?: unknown; name?: unknown; host?: unknown; serverId?: unknown; syncedAt?: unknown };
      if (typeof record.name === "string" && typeof record.host === "string" && typeof record.serverId === "string") {
        records.push({
          appId: typeof record.appId === "string" ? record.appId : "",
          name: record.name,
          host: record.host,
          serverId: record.serverId,
          syncedAt: typeof record.syncedAt === "string" ? record.syncedAt : "",
        });
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

/**
 * Merge this app's partition into the mirror. Each syncing app owns one partition, so a board
 * viewed from another machine's app never drops the hosts this machine's app mirrored.
 */
export function writeAppHosts(
  entries: readonly AppHostSyncInputEntry[],
  options: { appId?: string; localServerId?: string; reservedNames?: ReadonlySet<string> } = {},
): { synced: number; changed: boolean } {
  const localNameChanged = writeLocalHostName(entries, options.localServerId);
  const appId = options.appId ?? "";
  const incoming = toAppHostRecords(entries, options);
  const records = mergeAppHostRecords(readAppHosts(), incoming, appId, options.reservedNames ?? new Set());
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
