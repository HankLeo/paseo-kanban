import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";

/**
 * Pure derivations for the kanban board from Paseo's workspace and agent directories. Nothing in
 * here touches React, React Native, or Node, so both runtimes and tests can import it.
 */

export const AGENT_ACTIVITIES = ["waiting", "unread", "working", "failing", "idle"] as const;

export type AgentActivity = (typeof AGENT_ACTIVITIES)[number];

export const AGENT_ACTIVITY_LABELS: Record<AgentActivity, string> = {
  waiting: "Waiting for your answer",
  unread: "Finished, not read yet",
  working: "Working",
  failing: "Failed",
  idle: "Idle",
};

/** Lucide icon per agent activity, drawn inside cards and column headers. */
export const AGENT_ACTIVITY_ICONS: Record<AgentActivity, string> = {
  waiting: "CircleAlert",
  unread: "CircleDot",
  working: "LoaderCircle",
  failing: "CircleX",
  idle: "Circle",
};

/** Lucide icon per provider, drawn before the provider/model text on cards. */
const PROVIDER_ICONS: Record<string, string> = {
  claude: "Sparkles",
  codex: "Code",
  copilot: "Github",
  opencode: "Terminal",
  pi: "Pi",
  omp: "Pi",
  cursor: "MousePointer2",
  gemini: "Gemini",
};

export function providerIcon(provider: string): string {
  return PROVIDER_ICONS[provider] ?? "Bot";
}

export const AGENT_ACTIVITY_RANK: Record<AgentActivity, number> = {
  waiting: 0,
  unread: 1,
  working: 2,
  failing: 3,
  idle: 4,
};

export type PullRequestState = "open" | "merged" | "closed";
export type PullRequestChecks = "passed" | "failed" | "running" | "none";
export type PullRequestReview = "approved" | "changes_requested" | "pending" | null;

export interface DashPullRequest {
  number: number | null;
  url: string;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  checks: PullRequestChecks;
  checksCompleted: number;
  checksTotal: number;
  review: PullRequestReview;
  /** Forge id (`github`, `gitlab`, ...); defaults to GitHub like the app does. */
  forge: string;
}

export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  copilot: "Copilot",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "Oh My Pi",
  cursor: "Cursor",
  gemini: "Gemini",
};

export function providerLabel(provider: string): string {
  const known = PROVIDER_LABELS[provider];
  if (known) return known;
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Agent";
}

const SHORT_NAME_MAX = 22;

export function shortenName(name: string, max: number = SHORT_NAME_MAX): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getParentAgentId(agent: Pick<PaseoAgent, "labels">): string | null {
  const value = agent.labels?.[PARENT_AGENT_ID_LABEL];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * A root agent owns a workspace track. Subagents that run in their parent's workspace only
 * contribute activity; a subagent placed in another workspace is that workspace's root. An
 * unknown parent (archived, on another daemon) leaves the agent visible rather than hidden.
 */
export function isWorkspaceRootAgent(
  agent: Pick<PaseoAgent, "labels" | "workspaceId">,
  agentsById: ReadonlyMap<string, Pick<PaseoAgent, "workspaceId">>,
): boolean {
  const parentId = getParentAgentId(agent);
  if (!parentId) return true;
  const parent = agentsById.get(parentId);
  if (!parent) return true;
  return Boolean(agent.workspaceId && parent.workspaceId && agent.workspaceId !== parent.workspaceId);
}

export function deriveAgentActivity(
  agent: Pick<
    PaseoAgent,
    "status" | "pendingPermissions" | "requiresAttention" | "attentionReason"
  >,
): AgentActivity {
  if ((agent.pendingPermissions?.length ?? 0) > 0 || agent.attentionReason === "permission") {
    return "waiting";
  }
  if (agent.status === "error" || agent.attentionReason === "error") return "failing";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  if (agent.requiresAttention) return "unread";
  return "idle";
}

function parsePullRequestNumber(url: string): number | null {
  const match = /\/(?:pull|pulls|merge_requests)\/(\d+)(?:\/|$)/.exec(safePathname(url));
  if (!match) return null;
  const number = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(number) ? number : null;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

type WorkspacePullRequest = NonNullable<NonNullable<PaseoWorkspace["githubRuntime"]>["pullRequest"]>;

function summarizeChecks(pullRequest: WorkspacePullRequest): {
  checks: PullRequestChecks;
  completed: number;
  total: number;
} {
  const checks = pullRequest.checks ?? [];
  if (checks.length > 0) {
    let completed = 0;
    let failed = false;
    for (const check of checks) {
      if (check.status === "failure" || check.status === "cancelled") failed = true;
      if (check.status !== "pending") completed += 1;
    }
    if (failed) return { checks: "failed", completed: checks.length, total: checks.length };
    if (completed === checks.length) return { checks: "passed", completed, total: checks.length };
    return { checks: "running", completed, total: checks.length };
  }
  switch (pullRequest.checksStatus) {
    case "success":
      return { checks: "passed", completed: 1, total: 1 };
    case "failure":
      return { checks: "failed", completed: 1, total: 1 };
    case "pending":
      return { checks: "running", completed: 0, total: 1 };
    default:
      return { checks: "none", completed: 0, total: 0 };
  }
}

export function toDashPullRequest(workspace: PaseoWorkspace): DashPullRequest | null {
  const pullRequest = workspace.githubRuntime?.pullRequest;
  if (!pullRequest?.url) return null;
  const rawState = pullRequest.state.toLowerCase();
  let state: PullRequestState;
  if (pullRequest.isMerged || rawState === "merged") state = "merged";
  else if (rawState === "open") state = "open";
  else state = "closed";
  const summary = summarizeChecks(pullRequest);
  return {
    number: pullRequest.number ?? parsePullRequestNumber(pullRequest.url),
    url: pullRequest.url,
    title: pullRequest.title,
    state,
    isDraft: pullRequest.isDraft ?? false,
    checks: summary.checks,
    checksCompleted: summary.completed,
    checksTotal: summary.total,
    review: pullRequest.reviewDecision ?? null,
    forge: workspace.forge && workspace.forge.length > 0 ? workspace.forge : "github",
  };
}

export function workspaceDisplayName(
  workspace: Pick<PaseoWorkspace, "name" | "title">,
  agentTitles: readonly string[],
): string {
  return workspace.title?.trim() || agentTitles[0]?.trim() || workspace.name;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Compact relative time the way the sidebar shows it: `now`, `5m`, `2h`, `3d`, `Jan 15`. */
export function formatTimeAgo(timestampMs: number, nowMs: number): string {
  if (!timestampMs) return "";
  const elapsed = nowMs - timestampMs;
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d`;
  const date = new Date(timestampMs);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Initial drawn in the generated project icon: last path segment, first character. */
export function projectInitial(displayName: string): string {
  const segments = displayName.trim().split("/").filter(Boolean);
  const label = segments[segments.length - 1] ?? displayName.trim();
  return label.charAt(0).toUpperCase();
}
