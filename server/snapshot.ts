import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  createPaseoApi,
  type PaseoAgent,
  type PaseoApi,
  type PaseoClient,
  type PaseoClientConfig,
  type PaseoWorkspace,
} from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  DEFAULT_RELAY_ENDPOINT,
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  normalizeRelayProtocolVersion,
  parseConnectionUri,
  parseHostPort,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { KanbanHostSchema, type KanbanHost } from "../shared/contracts";
import { findAppHost, readAppHosts, readLocalHostName } from "./app-hosts";
import { readHosts, type KanbanHostConfig } from "./hosts";
import { paseoHome } from "./paseo-home";

const TIMEOUT_MS = 8_000;
const COLLECTION_TIMEOUT_MS = 12_000;
const CACHE_MS = 30_000;
const MAX_PAGES = 50;
const HOST_CACHE_FILE = join(paseoHome(), "plugin-data", "paseo-kanban", "snapshot.json");
/** Local display name: the app-registry label when mirrored, else the OS hostname. */
function localHostName(): string {
  return readLocalHostName() ?? hostname();
}

let cachedServerId: string | null | undefined;
/** The local daemon's own server id, used to drop mirrored connections that loop back to it. */
function localServerId(): string | null {
  if (cachedServerId !== undefined) return cachedServerId;
  try {
    const value = readFileSync(join(paseoHome(), "server-id"), "utf8").trim();
    cachedServerId = value.length > 0 ? value : null;
  } catch {
    cachedServerId = null;
  }
  return cachedServerId;
}
let generation = 0;
let cached: { at: number; value: KanbanSnapshot } | null = null;
let inflight: { generation: number; promise: Promise<KanbanSnapshot> } | null = null;
const clients = new Map<string, { host: string; client: KanbanRemoteClient; serverId: string | null }>();

type KanbanSnapshot = { refreshedAt: string; hosts: KanbanHost[] };
type ClientTarget = { config: PaseoClientConfig; serverId: string | null };
type CachedHost = { fingerprint: string; host: KanbanHost };
type KanbanRemoteClient = PaseoClient & Pick<DaemonClient, "getDaemonStatus">;

/** Same wiring as createPaseoClient, but keeps the DaemonClient reachable for status lookups. */
function createRemoteClient(config: PaseoClientConfig): KanbanRemoteClient {
  const daemonClient = new DaemonClient({ ...config, clientId: `paseo-kanban-${randomUUID()}`, clientType: "cli" });
  return {
    ...createPaseoApi(daemonClient),
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
    getDaemonStatus: (options) => daemonClient.getDaemonStatus(options),
  };
}

function readHostCache(): Map<string, CachedHost> {
  try {
    const value = JSON.parse(readFileSync(HOST_CACHE_FILE, "utf8")) as { version?: unknown; hosts?: unknown };
    if (value.version !== 1 || !value.hosts || typeof value.hosts !== "object" || Array.isArray(value.hosts)) return new Map();
    const entries: [string, CachedHost][] = [];
    for (const [id, candidate] of Object.entries(value.hosts)) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const record = candidate as { fingerprint?: unknown; host?: unknown };
      const parsed = KanbanHostSchema.safeParse(record.host);
      if (typeof record.fingerprint === "string" && parsed.success) {
        entries.push([id, { fingerprint: record.fingerprint, host: parsed.data }]);
      }
    }
    return new Map(entries);
  } catch {
    return new Map();
  }
}

const lastSuccessful = readHostCache();

function hostFingerprint(host?: string): string {
  return host ? createHash("sha256").update(host).digest("hex") : "local";
}

function writeHostCache(): void {
  try {
    mkdirSync(dirname(HOST_CACHE_FILE), { recursive: true, mode: 0o700 });
    const temp = `${HOST_CACHE_FILE}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, hosts: Object.fromEntries(lastSuccessful) })}\n`, { mode: 0o600 });
    renameSync(temp, HOST_CACHE_FILE);
  } catch {
    // A cache write must never take the live board down.
  }
}

export function clientTarget(host: string): ClientTarget {
  const match = /#offer=([A-Za-z0-9_-]+)/.exec(host);
  if (match) {
    const offer = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")) as {
      v?: unknown;
      serverId?: unknown;
      daemonPublicKeyB64?: unknown;
      relay?: { endpoint?: unknown; useTls?: unknown };
    };
    if (typeof offer.serverId !== "string" || typeof offer.daemonPublicKeyB64 !== "string") {
      throw new Error("Pairing URL has an invalid offer.");
    }
    const endpoint = typeof offer.relay?.endpoint === "string"
      ? offer.relay.endpoint
      : DEFAULT_RELAY_ENDPOINT;
    const useTls = typeof offer.relay?.useTls === "boolean"
      ? offer.relay.useTls
      : shouldUseTlsForDefaultHostedRelay(endpoint);
    return {
      serverId: offer.serverId,
      config: {
        url: buildRelayWebSocketUrl({
          endpoint,
          useTls,
          serverId: offer.serverId,
          role: "client",
          version: normalizeRelayProtocolVersion(offer.v),
        }),
        e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
        connectTimeoutMs: TIMEOUT_MS,
        reconnect: { enabled: true, baseDelayMs: 1_000, maxDelayMs: 30_000 },
      },
    };
  }

  if (host.startsWith("ws://") || host.startsWith("wss://")) {
    const url = new URL(host);
    const password = url.searchParams.get("password") ?? undefined;
    url.searchParams.delete("password");
    if (url.pathname === "/") url.pathname = "/ws";
    return { serverId: null, config: { url: url.toString(), password, connectTimeoutMs: TIMEOUT_MS } };
  }

  const parsed = host.startsWith("tcp://")
    ? parseConnectionUri(host)
    : { ...parseHostPort(host), useTls: false, password: undefined };
  const endpoint = parsed.isIpv6 ? `[${parsed.host}]:${parsed.port}` : `${parsed.host}:${parsed.port}`;
  return {
    serverId: null,
    config: {
      url: buildDaemonWebSocketUrl(endpoint, { useTls: parsed.useTls }),
      password: parsed.password,
      connectTimeoutMs: TIMEOUT_MS,
      reconnect: { enabled: true, baseDelayMs: 1_000, maxDelayMs: 30_000 },
    },
  };
}

export async function listAgents(paseo: PaseoApi): Promise<PaseoAgent[]> {
  const agents: PaseoAgent[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await paseo.agents.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const { agent } of page.entries) {
      if (ids.has(agent.id)) throw new Error(`Agent directory repeated '${agent.id}'.`);
      ids.add(agent.id);
      agents.push(agent);
    }
    if (!page.pageInfo.hasMore) return agents.filter((agent) => !agent.archivedAt && Boolean(agent.workspaceId));
    const next = page.pageInfo.nextCursor;
    if (!next || cursors.has(next)) throw new Error("Agent directory returned an invalid pagination cursor.");
    cursors.add(next);
    cursor = next;
  }
  throw new Error("Agent directory exceeded the pagination limit.");
}

async function listWorkspaces(paseo: PaseoApi): Promise<PaseoWorkspace[]> {
  const workspaces: PaseoWorkspace[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await paseo.workspaces.list({ page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const workspace of page.entries) {
      if (ids.has(workspace.id)) throw new Error(`Workspace directory repeated '${workspace.id}'.`);
      ids.add(workspace.id);
      workspaces.push(workspace);
    }
    if (!page.pageInfo.hasMore) return workspaces;
    const next = page.pageInfo.nextCursor;
    if (!next || cursors.has(next)) throw new Error("Workspace directory returned an invalid pagination cursor.");
    cursors.add(next);
    cursor = next;
  }
  throw new Error("Workspace directory exceeded the pagination limit.");
}

async function inventory(paseo: PaseoApi): Promise<{ agents: PaseoAgent[]; workspaces: PaseoWorkspace[] }> {
  const [agents, allWorkspaces] = await Promise.all([listAgents(paseo), listWorkspaces(paseo)]);
  const visibleWorkspaceIds = new Set(agents.map((agent) => agent.workspaceId).filter(Boolean));
  return { agents, workspaces: allWorkspaces.filter((workspace) => visibleWorkspaceIds.has(workspace.id)) };
}

export function withDeadline<T>(promise: Promise<T>, label: string, timeoutMs = COLLECTION_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    void promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function inspectLocal(paseo: PaseoApi): Promise<KanbanHost> {
  const fingerprint = hostFingerprint();
  try {
    const { agents, workspaces } = await withDeadline(inventory(paseo), "Local inventory");
    const host = { id: "local", name: localHostName(), serverId: null, reachable: true, error: null, agents, workspaces };
    lastSuccessful.set(host.id, { fingerprint, host });
    return host;
  } catch (cause) {
    return failedHost("local", localHostName(), cause, undefined, fingerprint);
  }
}

async function remoteClient(config: KanbanHostConfig): Promise<{ client: KanbanRemoteClient; serverId: string | null }> {
  const existing = clients.get(config.name);
  if (existing?.host === config.host) {
    await existing.client.connect();
    return existing;
  }
  if (existing) await existing.client.close();
  const target = clientTarget(config.host);
  const client = createRemoteClient(target.config);
  const entry = { host: config.host, client, serverId: target.serverId };
  clients.set(config.name, entry);
  await client.connect();
  if (!entry.serverId) {
    // Direct TCP targets carry no server id in the connection string; ask the daemon itself.
    // Best-effort: older daemons or permission failures leave it null.
    try {
      const status = await client.getDaemonStatus();
      entry.serverId = typeof status.serverId === "string" && status.serverId.length > 0 ? status.serverId : null;
    } catch {
      // Self-detection and remote navigation degrade, inventory still works.
    }
  }
  return entry;
}

async function apiForHost(paseo: PaseoApi, hostId: string): Promise<PaseoApi> {
  if (hostId === "local") return paseo;
  const manual = readHosts().find(({ name }) => name === hostId);
  const appRecord = manual ? null : findAppHost(hostId);
  const config: KanbanHostConfig | null = manual ?? (appRecord ? { name: appRecord.name, host: appRecord.host } : null);
  if (!config) throw new Error(`Unknown kanban host '${hostId}'.`);
  return (await remoteClient(config)).client;
}

/** Manual hosts win on name collisions; app-mirrored hosts fill the rest. */
function allRemoteConfigs(): KanbanHostConfig[] {
  const manual = readHosts();
  const manualNames = new Set(manual.map(({ name }) => name));
  const mirrored = readAppHosts()
    .filter((record) => !manualNames.has(record.name))
    .map((record) => ({ name: record.name, host: record.host }));
  return [...manual, ...mirrored];
}

export async function updateWorkspaceTitle(paseo: PaseoApi, hostId: string, workspaceId: string, title: string | null) {
  const target = await apiForHost(paseo, hostId);
  return withDeadline(target.workspaces.ref(workspaceId).setTitle(title), `${hostId} title update`);
}

export async function archiveWorkspace(paseo: PaseoApi, hostId: string, workspaceId: string): Promise<{ archivedAt: string }> {
  const target = await apiForHost(paseo, hostId);
  const result = await withDeadline(target.workspaces.archive(workspaceId), `${hostId} archive`);
  if (result.error || !result.archivedAt) throw new Error(result.error || "Workspace archive failed.");
  const cachedHost = lastSuccessful.get(hostId);
  if (cachedHost) {
    cachedHost.host.workspaces = cachedHost.host.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, archivingAt: result.archivedAt } : workspace,
    );
    writeHostCache();
  }
  return { archivedAt: result.archivedAt };
}

export async function archiveAgent(paseo: PaseoApi, hostId: string, agentId: string): Promise<{ archivedAt: string }> {
  const target = await apiForHost(paseo, hostId);
  const result = await withDeadline(target.agents.ref(agentId).archive(), `${hostId} agent archive`);
  const cachedHost = lastSuccessful.get(hostId);
  if (cachedHost) {
    cachedHost.host.agents = cachedHost.host.agents.filter((agent) => agent.id !== agentId);
    writeHostCache();
  }
  return result;
}

async function inspectRemote(config: KanbanHostConfig): Promise<KanbanHost | null> {
  const fingerprint = hostFingerprint(config.host);
  try {
    const result = await withDeadline((async () => {
      const entry = await remoteClient(config);
      const { agents, workspaces } = await inventory(entry.client);
      return { entry, agents, workspaces };
    })(), `${config.name} inventory`);
    const self = localServerId();
    if (self && result.entry.serverId === self) {
      // The app registry mirrored a loopback endpoint (e.g. localhost:6767) that resolves to
      // this daemon: drop the duplicate instead of listing the local sessions twice.
      clients.delete(config.name);
      void result.entry.client.close();
      lastSuccessful.delete(config.name);
      return null;
    }
    const host = {
      id: config.name,
      name: config.name,
      // App-mirrored hosts carry the registry serverId even for direct TCP connections,
      // which enables native `paseo agent open --server` navigation for them.
      serverId: result.entry.serverId ?? findAppHost(config.name)?.serverId ?? null,
      reachable: true,
      error: null,
      agents: result.agents,
      workspaces: result.workspaces,
    };
    lastSuccessful.set(host.id, { fingerprint, host });
    return host;
  } catch (cause) {
    const entry = clients.get(config.name);
    if (entry) {
      clients.delete(config.name);
      void entry.client.close();
    }
    return failedHost(config.name, config.name, cause, config.host, fingerprint);
  }
}

export function offlineHost(id: string, name: string, error: string, previous?: KanbanHost): KanbanHost {
  return previous
    ? { ...previous, id, name, reachable: false, error }
    : { id, name, serverId: null, reachable: false, error, agents: [], workspaces: [] };
}

function failedHost(id: string, name: string, cause: unknown, secret: string | undefined, fingerprint: string): KanbanHost {
  const message = cause instanceof Error ? cause.message : String(cause);
  const error = (secret ? message.replaceAll(secret, "<host>") : message).slice(0, 400);
  const cachedHost = lastSuccessful.get(id);
  return offlineHost(id, name, error, cachedHost?.fingerprint === fingerprint ? cachedHost.host : undefined);
}

async function closeRemovedClients(remotes: KanbanHostConfig[]): Promise<void> {
  const current = new Set(remotes.map(({ name }) => name));
  await Promise.all([...clients.entries()].map(async ([name, entry]) => {
    if (current.has(name)) return;
    clients.delete(name);
    await entry.client.close();
  }));
  for (const name of lastSuccessful.keys()) {
    if (name !== "local" && !current.has(name)) lastSuccessful.delete(name);
  }
}

export function invalidateSnapshot(): void {
  generation += 1;
  cached = null;
}

export function getSnapshot(paseo: PaseoApi, refresh = false): Promise<KanbanSnapshot> {
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
  if (inflight?.generation === generation) return inflight.promise;

  const startedAtGeneration = generation;
  const promise = (async () => {
    const remotes = allRemoteConfigs();
    await closeRemovedClients(remotes);
    // ponytail: bounded 21-host fanout; add a worker pool if larger fleets become real.
    const hosts = (await Promise.all([inspectLocal(paseo), ...remotes.map(inspectRemote)])).filter(
      (host): host is KanbanHost => host !== null,
    );
    writeHostCache();
    const value = { refreshedAt: new Date().toISOString(), hosts };
    if (generation === startedAtGeneration) cached = { at: Date.now(), value };
    return value;
  })();
  inflight = { generation: startedAtGeneration, promise };
  const clear = () => {
    if (inflight?.promise === promise) inflight = null;
  };
  void promise.then(clear, clear);
  return promise;
}

export async function closeKanbanClients(): Promise<void> {
  const active = [...clients.values()];
  clients.clear();
  await Promise.all(active.map(({ client }) => client.close()));
}
