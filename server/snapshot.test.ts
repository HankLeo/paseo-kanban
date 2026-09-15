import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoApi } from "@getpaseo/client";
import type { KanbanHost } from "../shared/contracts";
import { workspaceDisplayName } from "../shared/model";
import { clientTarget, listAgents, offlineHost, updateWorkspaceTitle, withDeadline } from "./snapshot";

test("builds direct and encrypted relay SDK targets", () => {
  const direct = clientTarget("tcp://example.test:6767?ssl=true&password=secret");
  assert.equal(direct.config.url, "wss://example.test:6767/ws");
  assert.equal(direct.config.password, "secret");
  assert.equal(direct.serverId, null);

  const payload = Buffer.from(JSON.stringify({
    v: 2,
    serverId: "srv_remote",
    daemonPublicKeyB64: "public-key",
    relay: { endpoint: "relay.example.test:443", useTls: true },
  })).toString("base64url");
  const relay = clientTarget(`https://app.paseo.sh/#offer=${payload}`);
  assert.match(relay.config.url, /^wss:\/\/relay\.example\.test\/ws\?/);
  assert.match(relay.config.url, /serverId=srv_remote/);
  assert.match(relay.config.url, /role=client/);
  assert.deepEqual(relay.config.e2ee, { enabled: true, daemonPublicKeyB64: "public-key" });
  assert.equal(relay.serverId, "srv_remote");
});

test("uses an agent title when a workspace has only a generated name", () => {
  assert.equal(
    workspaceDisplayName({ name: "ah-generated-branch", title: null }, ["Review PR #42"]),
    "Review PR #42",
  );
  assert.equal(
    workspaceDisplayName({ name: "generated", title: "Pinned workspace title" }, ["Agent title"]),
    "Pinned workspace title",
  );
});

test("updates a local workspace title through the SDK", async () => {
  let received: string | null | undefined;
  const paseo = {
    workspaces: {
      ref: (id: string) => ({
        setTitle: async (title: string | null) => {
          assert.equal(id, "workspace");
          received = title;
          return { title };
        },
      }),
    },
  } as unknown as PaseoApi;
  assert.deepEqual(await updateWorkspaceTitle(paseo, "local", "workspace", "New title"), { title: "New title" });
  assert.equal(received, "New title");
});

test("keeps the last successful inventory when a host goes offline", () => {
  const previous = {
    id: "remote",
    name: "Remote",
    serverId: "srv_remote",
    reachable: true,
    error: null,
    agents: [{ id: "agent" }],
    workspaces: [{ id: "workspace" }],
  };
  const offline = offlineHost("remote", "Remote", "timed out", previous as unknown as KanbanHost);
  assert.equal(offline.reachable, false);
  assert.equal(offline.error, "timed out");
  assert.equal(offline.serverId, "srv_remote");
  assert.equal(offline.agents.length, 1);
  assert.equal(offline.workspaces.length, 1);
});

test("bounds host collection and rejects repeated pagination cursors", async () => {
  await assert.rejects(withDeadline(new Promise<never>(() => {}), "Remote", 5), /Remote timed out/);

  const paseo = {
    agents: {
      list: async () => ({
        entries: [],
        pageInfo: { hasMore: true, nextCursor: "same", prevCursor: null },
      }),
    },
  } as unknown as PaseoApi;
  await assert.rejects(listAgents(paseo), /invalid pagination cursor/);
});
