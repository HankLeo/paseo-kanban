import type { PluginServerContext } from "@getpaseo/plugin/server";
import { writeAppHosts } from "./server/app-hosts";
import { addHost, readHosts, removeHost } from "./server/hosts";
import { openAgentInDesktop } from "./server/open-agent";
import {
  archiveAgent,
  archiveWorkspace,
  closeKanbanClients,
  getSnapshot,
  invalidateSnapshot,
  updateWorkspaceTitle,
} from "./server/snapshot";
import { clearUnread, markUnread, readMarks } from "./server/unread-marks";
import {
  addKanbanHost,
  archiveKanbanAgent,
  archiveKanbanWorkspace,
  clearAgentUnread,
  getSnapshot as getSnapshotRpc,
  listKanbanHosts,
  markAgentUnread,
  openKanbanAgent,
  removeKanbanHost,
  setKanbanWorkspaceTitle,
  syncAppHosts,
} from "./shared/contracts";
import { boardPreferences } from "./shared/preferences";

const names = () => ({ hosts: readHosts().map(({ name }) => ({ name })) });

export default function contribute(server: PluginServerContext) {
  server.registerSettings(boardPreferences);
  server.handle(getSnapshotRpc, async ({ refresh }, { paseo }) => ({
    ...(await getSnapshot(paseo, refresh)),
    marks: readMarks(),
  }));
  server.handle(listKanbanHosts, () => names());
  server.handle(addKanbanHost, ({ name, host }) => {
    if (name === "local") throw new Error("'local' is reserved for this daemon.");
    if (readHosts().length >= 20) throw new Error("The kanban board supports at most 20 remote hosts.");
    addHost({ name, host });
    invalidateSnapshot();
    return names();
  });
  server.handle(removeKanbanHost, ({ name }) => {
    removeHost(name);
    invalidateSnapshot();
    return names();
  });
  server.handle(archiveKanbanWorkspace, async ({ hostId, workspaceId }, { paseo }) => {
    const result = await archiveWorkspace(paseo, hostId, workspaceId);
    invalidateSnapshot();
    return result;
  });
  server.handle(setKanbanWorkspaceTitle, async ({ hostId, workspaceId, title }, { paseo }) => {
    const result = await updateWorkspaceTitle(paseo, hostId, workspaceId, title || null);
    invalidateSnapshot();
    return result;
  });
  server.handle(archiveKanbanAgent, async ({ hostId, agentId }, { paseo }) => {
    const result = await archiveAgent(paseo, hostId, agentId);
    clearUnread(agentId);
    invalidateSnapshot();
    return result;
  });
  server.handle(markAgentUnread, ({ agentId }) => markUnread(agentId));
  server.handle(syncAppHosts, ({ appId, hosts, localServerId }) => {
    const reservedNames = new Set(readHosts().map(({ name }) => name));
    const result = writeAppHosts(hosts, { appId, localServerId, reservedNames });
    if (result.changed) invalidateSnapshot();
    return result;
  });
  server.handle(clearAgentUnread, ({ agentId }) => {
    clearUnread(agentId);
    return { cleared: true as const };
  });
  server.handle(openKanbanAgent, async ({ serverId, agentId }) => {
    await openAgentInDesktop(serverId, agentId);
    return { opened: true as const };
  });
  return closeKanbanClients;
}
