import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appHostConnectionString, readAppHosts, toAppHostRecords, writeAppHosts } from "./app-hosts";
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
  const first = writeFresh(entries, {});
  assert.deepEqual(first, { synced: 1, changed: true });
  const second = writeFresh(entries, {});
  assert.deepEqual(second, { synced: 1, changed: false });
  const third = writeFresh([], {});
  assert.deepEqual(third, { synced: 0, changed: true });
  assert.deepEqual(readFresh(), []);
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
