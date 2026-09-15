import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import {
  AGENT_ACTIVITY_RANK,
  type AgentActivity,
  type DashPullRequest,
  deriveAgentActivity,
  getParentAgentId,
  isWorkspaceRootAgent,
  parseTime,
  providerLabel,
  shortenName,
  toDashPullRequest,
  workspaceDisplayName,
} from "./model";

/**
 * Session-granularity board model. A card is a root agent session; subagent sessions nest inside
 * their parent's card. Everything here is pure so both runtimes and tests can import it.
 */

export interface SessionChild {
  id: string;
  title: string;
  shortName: string;
  activity: AgentActivity;
  starting: boolean;
  lastActivityAtMs: number;
}

export interface SessionCard {
  id: string;
  title: string;
  shortName: string;
  provider: string;
  providerName: string;
  model: string | null;
  activity: AgentActivity;
  /** True while the provider session is still starting; rendered as working. */
  starting: boolean;
  /** Epoch milliseconds; 0 when the daemon did not report the field. */
  createdAtMs: number;
  lastActivityAtMs: number;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  branch: string | null;
  pullRequest: DashPullRequest | null;
  workspaceLabels: readonly string[];
  /** Subagent sessions owned by this session, most important first. */
  children: readonly SessionChild[];
  /** ISO timestamp of an active plugin-owned unread mark, or null. */
  unreadMarkedAt: string | null;
}

export interface HostCards<Host = unknown> {
  host: Host;
  cards: readonly SessionCard[];
}

/**
 * A plugin-owned unread mark promotes an idle session to unread until the user opens it, or
 * until the session produces newer activity, at which point the real state supersedes it.
 */
export function isUnreadMarkActive(
  markedAt: string | undefined,
  agentActivityAtMs: number,
): boolean {
  if (!markedAt) return false;
  const marked = parseTime(markedAt);
  return marked > 0 && marked >= agentActivityAtMs;
}

function toSessionChild(agent: PaseoAgent): SessionChild {
  const title = agent.title?.trim() || providerLabel(agent.provider);
  return {
    id: agent.id,
    title,
    shortName: shortenName(title),
    activity: deriveAgentActivity(agent),
    starting: agent.status === "initializing",
    lastActivityAtMs: Math.max(parseTime(agent.updatedAt), parseTime(agent.attentionTimestamp)),
  };
}

function compareCards(a: SessionCard, b: SessionCard): number {
  const rank = AGENT_ACTIVITY_RANK[a.activity] - AGENT_ACTIVITY_RANK[b.activity];
  if (rank !== 0) return rank;
  if (a.lastActivityAtMs !== b.lastActivityAtMs) return b.lastActivityAtMs - a.lastActivityAtMs;
  return a.id.localeCompare(b.id);
}

export function buildSessionCards(input: {
  workspaces: Iterable<PaseoWorkspace>;
  agents: Iterable<PaseoAgent>;
  /** Agent unread marks: agentId → ISO timestamp. */
  unreadMarks: Readonly<Record<string, string>>;
}): SessionCard[] {
  const workspacesById = new Map<string, PaseoWorkspace>();
  for (const workspace of input.workspaces) {
    if (workspace.archivingAt) continue;
    workspacesById.set(workspace.id, workspace);
  }

  const agentsById = new Map<string, PaseoAgent>();
  for (const agent of input.agents) {
    if (agent.archivedAt || !agent.workspaceId) continue;
    if (!workspacesById.has(agent.workspaceId)) continue;
    agentsById.set(agent.id, agent);
  }

  const childrenByParent = new Map<string, SessionChild[]>();
  for (const agent of agentsById.values()) {
    if (isWorkspaceRootAgent(agent, agentsById)) continue;
    const parentId = getParentAgentId(agent);
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(toSessionChild(agent));
    childrenByParent.set(parentId, list);
  }

  const cards: SessionCard[] = [];
  for (const agent of agentsById.values()) {
    if (!isWorkspaceRootAgent(agent, agentsById)) continue;
    const workspace = workspacesById.get(agent.workspaceId as string);
    if (!workspace) continue;
    const lastActivityAtMs = Math.max(
      parseTime(agent.updatedAt),
      parseTime(agent.attentionTimestamp),
    );
    const mark = input.unreadMarks[agent.id];
    const marked = isUnreadMarkActive(mark, lastActivityAtMs);
    let activity = deriveAgentActivity(agent);
    let unreadMarkedAt: string | null = null;
    if (activity === "idle" && marked && mark) {
      activity = "unread";
      unreadMarkedAt = mark;
    }
    const title = agent.title?.trim() || providerLabel(agent.provider);
    const children = (childrenByParent.get(agent.id) ?? []).sort((a, b) => {
      const rank = AGENT_ACTIVITY_RANK[a.activity] - AGENT_ACTIVITY_RANK[b.activity];
      return rank !== 0 ? rank : b.lastActivityAtMs - a.lastActivityAtMs;
    });
    cards.push({
      id: agent.id,
      title,
      shortName: shortenName(title),
      provider: agent.provider,
      providerName: providerLabel(agent.provider),
      model: agent.model ?? null,
      activity,
      starting: agent.status === "initializing",
      createdAtMs: parseTime(agent.createdAt),
      lastActivityAtMs,
      workspaceId: workspace.id,
      workspaceName: workspaceDisplayName(workspace, [title]),
      projectId: workspace.projectId,
      projectName: workspace.projectDisplayName,
      branch: normalizeBranch(workspace.gitRuntime?.currentBranch),
      pullRequest: toDashPullRequest(workspace),
      workspaceLabels: workspace.labels ?? [],
      children,
      unreadMarkedAt,
    });
  }
  return cards.sort(compareCards);
}

function normalizeBranch(branch: string | null | undefined): string | null {
  const trimmed = branch?.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Swimlanes
// ---------------------------------------------------------------------------

export const LANE_DIMENSIONS = ["workspace", "project", "host"] as const;
export type LaneDimension = (typeof LANE_DIMENSIONS)[number];

export const LANE_DIMENSION_LABELS: Record<LaneDimension, string> = {
  workspace: "By workspace",
  host: "By host",
  project: "By project",
};

export interface Lane<Host = unknown> {
  id: string;
  title: string;
  subtitle: string | null;
  host: Host;
  /** Set only for the workspace dimension; used by workspace quick actions. */
  workspaceId: string | null;
  cards: readonly SessionCard[];
}

export function buildLanes<Host extends { id: string; name: string }>(
  entries: readonly HostCards<Host>[],
  dimension: LaneDimension,
): Lane<Host>[] {
  const lanes = new Map<string, Lane<Host> & { latestMs: number }>();
  const push = (laneId: string, host: Host, workspaceId: string | null, title: string, subtitle: string | null, card: SessionCard) => {
    const existing = lanes.get(laneId);
    if (existing) {
      (existing.cards as SessionCard[]).push(card);
      existing.latestMs = Math.max(existing.latestMs, card.lastActivityAtMs);
    } else {
      lanes.set(laneId, {
        id: laneId,
        title,
        subtitle,
        host,
        workspaceId,
        cards: [card],
        latestMs: card.lastActivityAtMs,
      });
    }
  };

  for (const { host, cards } of entries) {
    for (const card of cards) {
      switch (dimension) {
        case "workspace":
          push(`${host.id}:${card.workspaceId}`, host, card.workspaceId, card.workspaceName, card.projectName, card);
          break;
        case "host":
          push(host.id, host, null, host.name, null, card);
          break;
        case "project":
          push(`${host.id}:${card.projectId}`, host, null, card.projectName, host.name, card);
          break;
      }
    }
  }

  return [...lanes.values()]
    .sort((a, b) => b.latestMs - a.latestMs || a.title.localeCompare(b.title))
    .map(({ latestMs: _latestMs, ...lane }) => lane);
}

// ---------------------------------------------------------------------------
// Gantt
// ---------------------------------------------------------------------------

export const GANTT_WINDOW_IDS = ["24h", "7d", "30d"] as const;
export type GanttWindowId = (typeof GANTT_WINDOW_IDS)[number];

const GANTT_WINDOW_MS: Record<GanttWindowId, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function ganttWindowMs(windowId: GanttWindowId): number {
  return GANTT_WINDOW_MS[windowId];
}

export interface GanttBar {
  card: SessionCard;
  /** Clamped to the visible window. */
  startMs: number;
  endMs: number;
}

export interface GanttSection<Host = unknown> {
  id: string;
  title: string;
  subtitle: string | null;
  host: Host;
  workspaceId: string;
  bars: readonly GanttBar[];
}

/**
 * One bar per session: created → last activity, extended to now while the session is working.
 * Paseo reports no status history, so bars show lifespan, not state transitions.
 */
export function buildGanttSections<Host extends { id: string; name: string }>(
  entries: readonly HostCards<Host>[],
  windowId: GanttWindowId,
  nowMs: number,
): GanttSection<Host>[] {
  const windowStart = nowMs - GANTT_WINDOW_MS[windowId];
  const sections = new Map<string, GanttSection<Host> & { latestMs: number }>();

  for (const { host, cards } of entries) {
    for (const card of cards) {
      const activeEnd = card.activity === "working" ? nowMs : card.lastActivityAtMs;
      const endMs = Math.max(activeEnd, card.createdAtMs);
      // Skip sessions whose entire lifespan predates the window.
      if (endMs < windowStart && card.activity !== "working") continue;
      const startMs = Math.max(card.createdAtMs || endMs, windowStart);
      const id = `${host.id}:${card.workspaceId}`;
      const bar: GanttBar = { card, startMs, endMs: Math.max(endMs, startMs) };
      const existing = sections.get(id);
      if (existing) {
        (existing.bars as GanttBar[]).push(bar);
        existing.latestMs = Math.max(existing.latestMs, card.lastActivityAtMs);
      } else {
        sections.set(id, {
          id,
          title: card.workspaceName,
          subtitle: card.projectName,
          host,
          workspaceId: card.workspaceId,
          bars: [bar],
          latestMs: card.lastActivityAtMs,
        });
      }
    }
  }

  return [...sections.values()]
    .sort((a, b) => b.latestMs - a.latestMs || a.title.localeCompare(b.title))
    .map(({ latestMs: _latestMs, ...section }) => ({
      ...section,
      bars: [...section.bars].sort((a, b) => a.startMs - b.startMs || a.card.id.localeCompare(b.card.id)),
    }));
}
