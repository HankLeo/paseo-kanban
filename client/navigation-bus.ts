/**
 * Surface components cannot reach `PluginClientContext.openPanel` (it lives on the entry-level
 * context, not on surface props). The client entry binds the opener here so any card can expand
 * the explorer sidebar with the session detail panel.
 */

export type SessionDetailInput = { workspaceId: string; agentId: string };
type SessionDetailOpener = (input: SessionDetailInput) => void;

let opener: SessionDetailOpener | null = null;

export function bindSessionDetailOpener(next: SessionDetailOpener | null): void {
  opener = next;
}

export function openSessionDetail(input: SessionDetailInput): void {
  opener?.(input);
}
