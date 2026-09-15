import assert from "node:assert/strict";
import test from "node:test";
import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { buildGanttSections, buildLanes, buildSessionCards } from "./session-model";

function agent(overrides: Record<string, unknown>): PaseoAgent {
  return {
    id: "agent",
    provider: "claude",
    model: "opus",
    title: "Fix the bug",
    status: "idle",
    labels: {},
    workspaceId: "ws1",
    archivedAt: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    attentionTimestamp: null,
    pendingPermissions: [],
    requiresAttention: false,
    attentionReason: null,
    ...overrides,
  } as unknown as PaseoAgent;
}

function workspace(overrides: Record<string, unknown>): PaseoWorkspace {
  return {
    id: "ws1",
    projectId: "proj1",
    projectDisplayName: "Project One",
    name: "ws1",
    title: "Workspace One",
    archivingAt: null,
    labels: [],
    gitRuntime: { currentBranch: "main" },
    githubRuntime: { pullRequest: null },
    forge: "github",
    ...overrides,
  } as unknown as PaseoWorkspace;
}

test("builds cards for root sessions and skips archived or archiving entries", () => {
  const cards = buildSessionCards({
    workspaces: [workspace({}), workspace({ id: "ws-archiving", archivingAt: "2026-09-14T00:00:00.000Z" })],
    agents: [
      agent({ id: "live" }),
      agent({ id: "archived", archivedAt: "2026-09-13T00:00:00.000Z" }),
      agent({ id: "in-archiving-ws", workspaceId: "ws-archiving" }),
      agent({ id: "no-workspace", workspaceId: undefined }),
    ],
    unreadMarks: {},
  });
  assert.deepEqual(cards.map((card) => card.id), ["live"]);
  assert.equal(cards[0]?.activity, "idle");
  assert.equal(cards[0]?.workspaceName, "Workspace One");
  assert.equal(cards[0]?.branch, "main");
});

test("an active unread mark promotes an idle session to unread", () => {
  const marked = "2026-09-14T12:00:00.000Z";
  const cards = buildSessionCards({
    workspaces: [workspace({})],
    agents: [agent({ id: "marked" }), agent({ id: "stale-mark", updatedAt: "2026-09-15T00:00:00.000Z" })],
    unreadMarks: { marked, "stale-mark": "2026-09-13T00:00:00.000Z" },
  });
  const byId = new Map(cards.map((card) => [card.id, card]));
  assert.equal(byId.get("marked")?.activity, "unread");
  assert.equal(byId.get("marked")?.unreadMarkedAt, marked);
  // A mark older than the session's own activity is superseded by the real state.
  assert.equal(byId.get("stale-mark")?.activity, "idle");
  assert.equal(byId.get("stale-mark")?.unreadMarkedAt, null);
});

test("nests subagent sessions under their parent and keeps foreign-workspace children as roots", () => {
  const cards = buildSessionCards({
    workspaces: [workspace({}), workspace({ id: "ws2", title: "Workspace Two" })],
    agents: [
      agent({ id: "parent" }),
      agent({ id: "child", title: "Child task", labels: { "paseo.parent-agent-id": "parent" } }),
      agent({
        id: "child-elsewhere",
        title: "Child in ws2",
        workspaceId: "ws2",
        labels: { "paseo.parent-agent-id": "parent" },
      }),
    ],
    unreadMarks: {},
  });
  const byId = new Map(cards.map((card) => [card.id, card]));
  assert.equal(cards.length, 2);
  assert.deepEqual(byId.get("parent")?.children.map((child) => child.id), ["child"]);
  assert.equal(byId.get("child-elsewhere")?.workspaceId, "ws2");
});

test("sorts cards by activity rank then recency", () => {
  const cards = buildSessionCards({
    workspaces: [workspace({})],
    agents: [
      agent({ id: "idle-recent", updatedAt: "2026-09-15T00:00:00.000Z" }),
      agent({ id: "waiting-old", status: "idle", attentionReason: "permission", updatedAt: "2026-09-10T00:00:00.000Z" }),
      agent({ id: "idle-old", updatedAt: "2026-09-11T00:00:00.000Z" }),
    ],
    unreadMarks: {},
  });
  assert.deepEqual(cards.map((card) => card.id), ["waiting-old", "idle-recent", "idle-old"]);
});

test("builds lanes per workspace, host, and project dimension", () => {
  const hostA = { id: "local", name: "This host" };
  const hostB = { id: "remote", name: "Remote" };
  const cardsA = buildSessionCards({
    workspaces: [workspace({}), workspace({ id: "ws2", title: "Workspace Two" })],
    agents: [agent({ id: "a1" }), agent({ id: "a2", workspaceId: "ws2" })],
    unreadMarks: {},
  });
  const cardsB = buildSessionCards({
    workspaces: [workspace({})],
    agents: [agent({ id: "b1" })],
    unreadMarks: {},
  });
  const entries = [
    { host: hostA, cards: cardsA },
    { host: hostB, cards: cardsB },
  ];

  const byWorkspace = buildLanes(entries, "workspace");
  assert.equal(byWorkspace.length, 3);
  // Same workspace id on different hosts stays in different lanes.
  assert.deepEqual(
    byWorkspace.find((lane) => lane.host === hostB)?.cards.map((card) => card.id),
    ["b1"],
  );

  const byHost = buildLanes(entries, "host");
  assert.deepEqual(byHost.map((lane) => lane.title).sort(), ["Remote", "This host"]);
  assert.equal(byHost.find((lane) => lane.host === hostA)?.cards.length, 2);

  const byProject = buildLanes(entries, "project");
  assert.equal(byProject.length, 2);
  assert.equal(byProject.find((lane) => lane.host === hostB)?.subtitle, "Remote");
});

test("clamps gantt bars to the window, extends working bars to now, and drops stale sessions", () => {
  const now = Date.parse("2026-09-15T00:00:00.000Z");
  const host = { id: "local", name: "This host" };
  const cards = buildSessionCards({
    workspaces: [workspace({})],
    agents: [
      agent({ id: "old-but-live", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z" }),
      agent({ id: "working", status: "running", createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T12:00:00.000Z" }),
      agent({ id: "stale", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }),
    ],
    unreadMarks: {},
  });
  const sections = buildGanttSections([{ host, cards }], "7d", now);
  assert.equal(sections.length, 1);
  const bars = new Map(sections[0]?.bars.map((bar) => [bar.card.id, bar]));
  assert.equal(bars.has("stale"), false);
  // Session created before the window starts at the window edge, not at creation.
  assert.equal(bars.get("old-but-live")?.startMs, now - 7 * 24 * 60 * 60 * 1000);
  assert.equal(bars.get("working")?.endMs, now);
});
