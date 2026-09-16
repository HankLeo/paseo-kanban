import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { defineRpc } from "@getpaseo/plugin";
import { AgentSnapshotPayloadSchema, WorkspaceDescriptorPayloadSchema } from "@getpaseo/protocol/messages";
import { z } from "zod";

export const KanbanHostSchema = z.object({
  id: z.string(),
  name: z.string(),
  serverId: z.string().nullable(),
  reachable: z.boolean(),
  error: z.string().nullable(),
  workspaces: z.array(WorkspaceDescriptorPayloadSchema),
  agents: z.array(AgentSnapshotPayloadSchema),
});

export interface KanbanHost {
  id: string;
  name: string;
  serverId: string | null;
  reachable: boolean;
  error: string | null;
  workspaces: PaseoWorkspace[];
  agents: PaseoAgent[];
}

export const getSnapshot = defineRpc({
  name: "paseo-kanban.snapshot.get",
  input: z.object({ refresh: z.boolean().optional() }),
  output: z.object({
    refreshedAt: z.string(),
    hosts: z.array(KanbanHostSchema),
    /** Agent unread marks: agentId → ISO timestamp. */
    marks: z.record(z.string(), z.string()),
  }),
});

export const listKanbanHosts = defineRpc({
  name: "paseo-kanban.hosts.list",
  input: z.object({}),
  output: z.object({ hosts: z.array(z.object({ name: z.string() })) }),
});

export const addKanbanHost = defineRpc({
  name: "paseo-kanban.hosts.add",
  input: z.object({
    name: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
    host: z.string().trim().min(1).max(8192),
  }),
  output: z.object({ hosts: z.array(z.object({ name: z.string() })) }),
});

export const removeKanbanHost = defineRpc({
  name: "paseo-kanban.hosts.remove",
  input: z.object({ name: z.string().min(1).max(80) }),
  output: z.object({ hosts: z.array(z.object({ name: z.string() })) }),
});

export const archiveKanbanWorkspace = defineRpc({
  name: "paseo-kanban.workspace.archive",
  input: z.object({ hostId: z.string().min(1).max(80), workspaceId: z.string().min(1) }),
  output: z.object({ archivedAt: z.string() }),
});

export const setKanbanWorkspaceTitle = defineRpc({
  name: "paseo-kanban.workspace.title.set",
  input: z.object({
    hostId: z.string().min(1).max(80),
    workspaceId: z.string().min(1),
    title: z.string().trim().max(200).nullable(),
  }),
  output: z.object({ title: z.string().nullable() }),
});

export const archiveKanbanAgent = defineRpc({
  name: "paseo-kanban.agent.archive",
  input: z.object({ hostId: z.string().min(1).max(80), agentId: z.string().min(1) }),
  output: z.object({ archivedAt: z.string() }),
});

export const markAgentUnread = defineRpc({
  name: "paseo-kanban.agent.unread.mark",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ markedAt: z.string() }),
});

export const clearAgentUnread = defineRpc({
  name: "paseo-kanban.agent.unread.clear",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ cleared: z.literal(true) }),
});

export const openKanbanAgent = defineRpc({
  name: "paseo-kanban.agent.open",
  input: z.object({ serverId: z.string().min(1), agentId: z.string().min(1) }),
  output: z.object({ opened: z.literal(true) }),
});

export const AppHostConnectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("directTcp"),
    endpoint: z.string().min(1).max(500),
    useTls: z.boolean().optional(),
    password: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("relay"),
    relayEndpoint: z.string().min(1).max(500),
    useTls: z.boolean().optional(),
    daemonPublicKeyB64: z.string().min(1).max(500),
  }),
]);

export type AppHostConnection = z.infer<typeof AppHostConnectionSchema>;

/**
 * The client mirrors the Paseo app's own host registry (read from app storage on web/desktop)
 * so daemons the user already added in the app appear on the board without a second setup.
 * Per-app partitions: each syncing app replaces only the hosts it knows, so several machines'
 * apps mirroring into the same daemon coexist instead of clobbering each other.
 */
export const syncAppHosts = defineRpc({
  name: "paseo-kanban.hosts.app.sync",
  input: z.object({
    /** Storage-scoped app instance id; partitions the mirror so apps do not overwrite each other. */
    appId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    localServerId: z.string().max(200).optional(),
    hosts: z
      .array(
        z.object({
          serverId: z.string().min(1).max(200),
          label: z.string().max(200).optional(),
          // Optional so the local profile can sync its label even when the app reaches it
          // through a connection the plugin cannot reproduce daemon-side.
          connection: AppHostConnectionSchema.optional(),
        }),
      )
      .max(20),
  }),
  output: z.object({ synced: z.number(), changed: z.boolean() }),
});
