/**
 * Web-only bridge to the Paseo app's own host registry. The app persists it through AsyncStorage,
 * which on web and the Electron renderer is plain localStorage; native builds get a no-op.
 * Everything here is best-effort: any schema drift or storage failure degrades to an empty list
 * and the board falls back to manually added hosts.
 */
import { Platform } from "react-native";
import type { AppHostConnection } from "../shared/contracts";

declare const localStorage: { getItem(key: string): string | null } | undefined;

const REGISTRY_STORAGE_KEY = "@paseo:daemon-registry";
const MAX_HOSTS = 20;

export interface AppHostSyncEntry {
  serverId: string;
  label?: string;
  connection?: AppHostConnection;
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function readConnection(profile: Record<string, unknown>): AppHostConnection | null {
  const connections = Array.isArray(profile.connections) ? profile.connections : [];
  const preferredId = readString(profile.preferredConnectionId, 200);
  const candidates = preferredId
    ? [...connections].sort((a, b) => {
        const aId = (a as Record<string, unknown>).id;
        const bId = (b as Record<string, unknown>).id;
        return (aId === preferredId ? -1 : 0) - (bId === preferredId ? -1 : 0);
      })
    : connections;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const connection = candidate as Record<string, unknown>;
    if (connection.type === "directTcp") {
      const endpoint = readString(connection.endpoint, 500);
      if (!endpoint) continue;
      const password = readString(connection.password, 500);
      return {
        type: "directTcp",
        endpoint,
        ...(typeof connection.useTls === "boolean" ? { useTls: connection.useTls } : {}),
        ...(password ? { password } : {}),
      };
    }
    if (connection.type === "relay") {
      const relayEndpoint = readString(connection.relayEndpoint, 500);
      const daemonPublicKeyB64 = readString(connection.daemonPublicKeyB64, 500);
      if (!relayEndpoint || !daemonPublicKeyB64) continue;
      return {
        type: "relay",
        relayEndpoint,
        ...(typeof connection.useTls === "boolean" ? { useTls: connection.useTls } : {}),
        daemonPublicKeyB64,
      };
    }
    // remoteSsh / directSocket / directPipe connections are tunneled by the app itself;
    // the plugin cannot reproduce them daemon-side, so those hosts are skipped.
  }
  return null;
}

export function readAppHostRegistry(): AppHostSyncEntry[] {
  if (Platform.OS !== "web") return [];
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(REGISTRY_STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: AppHostSyncEntry[] = [];
    for (const profile of parsed) {
      if (!profile || typeof profile !== "object") continue;
      const record = profile as Record<string, unknown>;
      const serverId = readString(record.serverId, 200);
      if (!serverId) continue;
      // Entries without a reproducible connection are still forwarded: the server ignores them
      // for remote inventory but uses the local one for its display name.
      const connection = readConnection(record) ?? undefined;
      const label = readString(record.label, 200);
      entries.push({ serverId, ...(label ? { label } : {}), ...(connection ? { connection } : {}) });
      if (entries.length >= MAX_HOSTS) break;
    }
    return entries;
  } catch {
    return [];
  }
}
