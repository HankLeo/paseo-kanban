import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appHostConnectionString,
  mergeAppHostRecords,
  readAppHosts,
  toAppHostRecords,
  writeAppHosts,
} from "./app-hosts";
import { clientTarget } from "./snapshot";

test("synthesizes direct TCP connection strings the inventory parser accepts", () => {
  const host = appHostConnectionString(
    { type: "directTcp", endpoint: "devbox.example.test:6767", useTls: true, password: "secret" },
    "srv_devbox",
  );
  const target = clientTarget(host);
  assert.equal(target.config.url, "wss://devbox.example.test:6767/ws");
  assert.equal(target.config.password, "secret");
  assert.equal(target.serverId, null);
});

test("synthesizes relay pairing URLs that round-trip through the pairing parser", () => {
  const host = appHostConnectionString(
    { type: "relay", relayEndpoint: "relay.example.test:443", useTls: true, daemonPublicKeyB64: "public-key" },
    "srv_remote",
  );
  const target = clientTarget(host);
  assert.equal(target.serverId, "srv_remote");
  assert.match(target.config.url, /^wss:\/\/relay\.example\.test\/ws\?/);
  assert.match(target.config.url, /serverId=srv_remote/);
  assert.deepEqual(target.config.e2ee, { enabled: true, daemonPublicKeyB64: "public-key" });
});

test("maps registry entries to records with local exclusion and name deduplication", () => {
  const records = toAppHostRecords(
    [
      {
        serverId: "srv_local",
        label: "My laptop",
        connection: { type: "directTcp", endpoint: "localhost:6767" },
      },
      {
        serverId: "srv_a",
        label: "build box!",
        connection: { type: "directTcp", endpoint: "a:6767" },
      },
      {
        serverId: "srv_b",
        label: "build box!",
        connection: { type: "relay", relayEndpoint: "relay:443", daemonPublicKeyB64: "pk" },
      },
    ],
    { localServerId: "srv_local", reservedNames: new Set(["manual"]) },
  );
  assert.equal(records.length, 2);
  assert.equal(records[0]?.name, "build-box");
  assert.equal(records[0]?.serverId, "srv_a");
  // Same label on a second host gets a deterministic suffix instead of a collision.
  assert.match(records[1]?.name ?? "", /^build-box-[0-9a-f]{6}$/);
  assert.notEqual(records[1]?.name, records[0]?.name);
  assert.equal(records[1]?.serverId, "srv_b");
});

test("persists the mirror with change detection", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-app-hosts-"));
  process.env.PASEO_HOME = home;
  const { writeAppHosts: writeFresh, readAppHosts: readFresh } = await import(`./app-hosts?test=${Date.now()}`);
  const entries = [
    {
      serverId: "srv_a",
      label: "devbox",
      connection: { type: "directTcp" as const, endpoint: "a:6767" },
    },
  ];
  const first = writeFresh(entries, { appId: "app-a" });
  assert.deepEqual(first, { synced: 1, changed: true });
  // An identical sync is a no-op: the stored timestamp is reused, not bumped.
  const second = writeFresh(entries, { appId: "app-a" });
  assert.deepEqual(second, { synced: 1, changed: false });
  const third = writeFresh([], { appId: "app-a" });
  assert.deepEqual(third, { synced: 0, changed: true });
  assert.deepEqual(readFresh(), []);
});

test("partitions the mirror per syncing app so apps do not clobber each other", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-app-hosts-partitions-"));
  process.env.PASEO_HOME = home;
  const { writeAppHosts: writeFresh, readAppHosts: readFresh } = await import(
    `./app-hosts?test=${Date.now()}partitions`
  );
  const workHosts = [
    { serverId: "srv_8c16g", label: "8C16G", connection: { type: "directTcp" as const, endpoint: "8c16g:6767" } },
    { serverId: "srv_4c8g", label: "4C8G", connection: { type: "directTcp" as const, endpoint: "4c8g:6767" } },
  ];
  const homeHosts = [
    { serverId: "srv_home", label: "home", connection: { type: "directTcp" as const, endpoint: "home:6767" } },
  ];
  writeFresh(workHosts, { appId: "work-app" });
  // The home app syncing an unrelated registry keeps the work app's hosts.
  writeFresh(homeHosts, { appId: "home-app" });
  let names = readFresh().map((record: { name: string }) => record.name).sort();
  assert.deepEqual(names, ["4C8G", "8C16G", "home"]);
  // Removing a host in one app only drops that app's partition.
  writeFresh([], { appId: "home-app" });
  names = readFresh().map((record: { name: string }) => record.name).sort();
  assert.deepEqual(names, ["4C8G", "8C16G"]);
});

test("keeps the owning app's mirror of a shared daemon until it stops listing it", () => {
  const previous = toAppHostRecords(
    [{ serverId: "srv_x", label: "shared", connection: { type: "directTcp", endpoint: "127.0.0.1:6767" } }],
    { appId: "app-a", now: "2026-09-16T08:00:00.000Z" },
  );
  const incoming = toAppHostRecords(
    [{ serverId: "srv_x", label: "shared", connection: { type: "relay", relayEndpoint: "relay:443", daemonPublicKeyB64: "pk" } }],
    { appId: "app-b", now: "2026-09-16T09:00:00.000Z" },
  );
  let merged = mergeAppHostRecords(previous, incoming, "app-b", new Set());
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.appId, "app-a");
  assert.match(merged[0]?.host ?? "", /^tcp:\/\//);
  // Once the owner drops the daemon, the other app's mirror takes over.
  merged = mergeAppHostRecords(merged, incoming, "app-a", new Set());
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.appId, "app-b");
  assert.match(merged[0]?.host ?? "", /^https:\/\/app\.paseo\.sh/);
});

test("refreshes the stored timestamp only when the mirrored connection changes", () => {
  const base = { serverId: "srv_a", label: "devbox", connection: { type: "directTcp" as const, endpoint: "a:6767" } };
  const first = toAppHostRecords([base], { appId: "app-a", now: "2026-09-16T08:00:00.000Z" });
  const resync = toAppHostRecords([base], { appId: "app-a", now: "2026-09-16T09:00:00.000Z" });
  let merged = mergeAppHostRecords(first, resync, "app-a", new Set());
  assert.equal(merged[0]?.syncedAt, "2026-09-16T08:00:00.000Z");
  const moved = toAppHostRecords(
    [{ ...base, connection: { type: "directTcp", endpoint: "a-new:6767" } }],
    { appId: "app-a", now: "2026-09-16T10:00:00.000Z" },
  );
  merged = mergeAppHostRecords(merged, moved, "app-a", new Set());
  assert.equal(merged[0]?.syncedAt, "2026-09-16T10:00:00.000Z");
});

test("claims pre-partition records it lists and keeps unclaimed ones", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-app-hosts-legacy-"));
  process.env.PASEO_HOME = home;
  const { writeAppHosts: writeFresh, readAppHosts: readFresh } = await import(
    `./app-hosts?test=${Date.now()}legacy`
  );
  writeFresh([{ serverId: "srv_old", label: "old", connection: { type: "directTcp" as const, endpoint: "old:6767" } }], {});
  // An app whose registry knows nothing about the legacy host keeps it instead of wiping it.
  writeFresh([{ serverId: "srv_new", label: "new", connection: { type: "directTcp" as const, endpoint: "new:6767" } }], {
    appId: "app-a",
  });
  let records = readFresh();
  assert.deepEqual(records.map((record: { name: string }) => record.name).sort(), ["new", "old"]);
  // An app that lists the legacy daemon claims it into its own partition.
  writeFresh([{ serverId: "srv_old", label: "old", connection: { type: "directTcp" as const, endpoint: "old:6767" } }], {
    appId: "app-b",
  });
  records = readFresh();
  assert.deepEqual(records.map((record: { name: string }) => record.name).sort(), ["new", "old"]);
  assert.equal(records.find((record: { serverId: string }) => record.serverId === "srv_old")?.appId, "app-b");
  // The claiming app can then remove it; other partitions are untouched.
  writeFresh([], { appId: "app-b" });
  records = readFresh();
  assert.deepEqual(records.map((record: { name: string }) => record.name), ["new"]);
});

test("skips entries without a reproducible connection but keeps their local label", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-local-name-"));
  process.env.PASEO_HOME = home;
  const { writeAppHosts: writeFresh, readLocalHostName: readName } = await import(
    `./app-hosts?test=${Date.now()}local`
  );
  const result = writeFresh(
    [
      { serverId: "srv_local", label: "MacBookPro" },
      { serverId: "srv_a", label: "devbox", connection: { type: "directTcp" as const, endpoint: "a:6767" } },
    ],
    { localServerId: "srv_local" },
  );
  assert.deepEqual(result, { synced: 1, changed: true });
  assert.equal(readName(), "MacBookPro");
});

test("clears the persisted local name when the mirror drops the local profile", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-local-name-clear-"));
  process.env.PASEO_HOME = home;
  const { writeAppHosts: writeFresh, readLocalHostName: readName } = await import(
    `./app-hosts?test=${Date.now()}clear`
  );
  writeFresh([{ serverId: "srv_local", label: "MacBookPro" }], { localServerId: "srv_local" });
  assert.equal(readName(), "MacBookPro");
  const result = writeFresh([], { localServerId: "srv_local" });
  assert.equal(result.changed, true);
  assert.equal(readName(), null);
});

test("readAppHosts tolerates a corrupt mirror file", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-app-hosts-corrupt-"));
  process.env.PASEO_HOME = home;
  const { writeAppHosts: writeFresh, readAppHosts: readFresh } = await import(`./app-hosts?test=${Date.now()}c`);
  writeFresh(
    [{ serverId: "srv_a", label: "devbox", connection: { type: "directTcp" as const, endpoint: "a:6767" } }],
    {},
  );
  const file = join(home, "plugin-data", "paseo-kanban", "app-hosts.json");
  assert.equal(readFresh().length, 1);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, "not json");
  assert.deepEqual(readFresh(), []);
});
