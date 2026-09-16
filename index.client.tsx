import type { PluginClientContext } from "@getpaseo/plugin/client";
import { KanbanSurface } from "./client/kanban-surface";

const SURFACE_ID = "kanban";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSurface(SURFACE_ID, KanbanSurface),
    client.addSidebarItem({
      id: "kanban",
      title: "Kanban",
      icon: "Kanban",
      surface: SURFACE_ID,
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
    for (const remove of removers) void remove();
  };
}
