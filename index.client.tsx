import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SessionDetailPanel } from "./client/components/session-detail-panel";
import { KanbanSurface } from "./client/kanban-surface";
import { bindSessionDetailOpener } from "./client/navigation-bus";

const SURFACE_ID = "kanban";

export default function contribute(client: PluginClientContext) {
  bindSessionDetailOpener(({ workspaceId, agentId }) => {
    client.openPanel("session-detail", { workspaceId, agentId, location: "explorer" });
  });
  const removers = [
    client.addSurface(SURFACE_ID, KanbanSurface),
    client.addSidebarItem({
      id: "kanban",
      title: "Kanban",
      icon: "Kanban",
      surface: SURFACE_ID,
    }),
    client.addWorkspacePanel({
      id: "session-detail",
      title: "Session detail",
      icon: "PanelRight",
      context: "agent",
      locations: ["workspace", "explorer"],
      Component: SessionDetailPanel,
    }),
    client.addCommandCenterItem({
      id: "open-kanban",
      title: "Open kanban board",
      icon: "Kanban",
      keywords: ["agents", "sessions", "board", "swimlane", "gantt", "kanban"],
      context: "global",
      onSelect({ openSurface }) {
        openSurface(SURFACE_ID);
      },
    }),
  ];
  return () => {
    bindSessionDetailOpener(null);
    for (const remove of removers) void remove();
  };
}
