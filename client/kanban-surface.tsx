import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  addKanbanHost,
  archiveKanbanAgent,
  archiveKanbanWorkspace,
  clearAgentUnread,
  getSnapshot,
  listKanbanHosts,
  markAgentUnread,
  openKanbanAgent,
  removeKanbanHost,
  setKanbanWorkspaceTitle,
  syncAppHosts,
  type KanbanHost,
} from "../shared/contracts";
import { themeScheme } from "../shared/colors";
import { AGENT_ACTIVITIES, type AgentActivity } from "../shared/model";
import { boardPreferences } from "../shared/preferences";
import {
  LANE_DIMENSIONS,
  LANE_DIMENSION_LABELS,
  GANTT_WINDOW_IDS,
  buildSessionCards,
  type HostCards,
  type LaneDimension,
  type SessionCard,
} from "../shared/session-model";
import { FilterBar } from "./components/filter-bar";
import { openSessionDetail } from "./navigation-bus";
import { readAppHostRegistry } from "./web";
import { GanttView } from "./views/gantt-view";
import { ListView } from "./views/list-view";
import { SwimlaneView } from "./views/swimlane-view";

const SNAPSHOT_KEY = ["paseo-kanban", "snapshot"] as const;
const HOSTS_KEY = ["paseo-kanban", "hosts"] as const;

const VIEW_OPTIONS = [
  { id: "swimlane", label: "Swimlane", icon: "Columns3" },
  { id: "list", label: "List", icon: "List" },
  { id: "gantt", label: "Gantt", icon: "ChartGantt" },
] as const;

type ViewId = (typeof VIEW_OPTIONS)[number]["id"];

export function KanbanSurface({ theme, layout, navigation, host }: PluginSurfaceProps) {
  const compact = layout.compact;
  const fetchSnapshot = useRpc(getSnapshot);
  const fetchHosts = useRpc(listKanbanHosts);
  const addHost = useRpc(addKanbanHost);
  const removeHost = useRpc(removeKanbanHost);
  const archiveWorkspace = useRpc(archiveKanbanWorkspace);
  const renameWorkspace = useRpc(setKanbanWorkspaceTitle);
  const archiveAgent = useRpc(archiveKanbanAgent);
  const markUnread = useRpc(markAgentUnread);
  const clearUnread = useRpc(clearAgentUnread);
  const openRemoteAgent = useRpc(openKanbanAgent);
  const syncHosts = useRpc(syncAppHosts);
  const queryClient = useQueryClient();
  const toast = useToast();
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const scheme = useMemo(() => themeScheme(theme), [theme]);

  const prefs = useSettings(boardPreferences);
  const view: ViewId = prefs.status === "ready" ? prefs.values.view : "swimlane";
  const laneDimension: LaneDimension = prefs.status === "ready" ? prefs.values.laneDimension : "workspace";
  const ganttWindow = prefs.status === "ready" ? prefs.values.ganttWindow : "7d";
  const savePrefs = useCallback(
    (patch: Partial<{ view: ViewId; laneDimension: LaneDimension; ganttWindow: typeof ganttWindow }>) => {
      if (prefs.status !== "ready") return;
      void prefs.save({ ...prefs.values, ...patch }, prefs.revision);
    },
    [prefs],
  );

  const [hostFilter, setHostFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [activityFilters, setActivityFilters] = useState<ReadonlySet<AgentActivity>>(
    () => new Set(AGENT_ACTIVITIES),
  );

  const snapshot = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: async () => {
      // Mirror the app's own host registry first so daemons added in Paseo appear
      // on the board on the next refresh without any plugin-side setup.
      try {
        await syncHosts({ hosts: readAppHostRegistry(), localServerId: host.id });
      } catch {
        // Host mirroring is best-effort; a failure never blocks the board snapshot.
      }
      return fetchSnapshot({ refresh: true });
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  const hosts = useQuery({ queryKey: HOSTS_KEY, queryFn: () => fetchHosts({}) });

  const invalidateBoard = useCallback(
    () => queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY }),
    [queryClient],
  );

  const add = useMutation({
    mutationFn: ({ name, host }: { name: string; host: string }) => addHost({ name, host }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: HOSTS_KEY }),
        invalidateBoard(),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: ({ name }: { name: string }) => removeHost({ name }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: HOSTS_KEY }),
        invalidateBoard(),
      ]);
    },
  });
  const archiveSession = useMutation({
    mutationFn: archiveAgent,
    onSuccess: invalidateBoard,
    onError: (cause) =>
      toast.error(cause instanceof Error ? cause.message : "Could not archive session."),
  });
  const toggleUnread = useMutation({
    mutationFn: async ({ agentId, marked }: { agentId: string; marked: boolean }) => {
      if (marked) await clearUnread({ agentId });
      else await markUnread({ agentId });
    },
    onSuccess: invalidateBoard,
    onError: (cause) =>
      toast.error(cause instanceof Error ? cause.message : "Could not update the unread mark."),
  });
  const rename = useMutation({
    mutationFn: renameWorkspace,
    onSuccess: invalidateBoard,
    onError: (cause) =>
      toast.error(cause instanceof Error ? cause.message : "Could not rename workspace."),
  });
  const archiveWs = useMutation({
    mutationFn: archiveWorkspace,
    onSuccess: invalidateBoard,
    onError: (cause) =>
      toast.error(cause instanceof Error ? cause.message : "Could not archive workspace."),
  });
  const openRemote = useMutation({
    mutationFn: (input: { serverId: string; agentId: string }) => openRemoteAgent(input),
  });

  const allHosts = snapshot.data?.hosts ?? [];
  const marks = useMemo(() => snapshot.data?.marks ?? {}, [snapshot.data]);
  const activeFilter =
    hostFilter === "all" || allHosts.some(({ id }) => id === hostFilter) ? hostFilter : "all";
  const visibleHosts = activeFilter === "all" ? allHosts : allHosts.filter(({ id }) => id === activeFilter);

  const cardsByHost = useMemo<HostCards<KanbanHost>[]>(
    () =>
      visibleHosts.map((host) => ({
        host,
        cards: buildSessionCards({
          workspaces: host.workspaces,
          agents: host.agents,
          unreadMarks: marks,
        }),
      })),
    [visibleHosts, marks],
  );
  const providers = useMemo(() => {
    const labels = new Map<string, string>();
    for (const { cards } of cardsByHost) {
      for (const card of cards) {
        if (!labels.has(card.provider)) labels.set(card.provider, card.providerName);
      }
    }
    return [
      { id: "all", label: "All providers" },
      ...[...labels.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, label]) => ({ id, label })),
    ];
  }, [cardsByHost]);
  const activeProviderFilter =
    providerFilter === "all" || providers.some(({ id }) => id === providerFilter)
      ? providerFilter
      : "all";
  const entries = useMemo<HostCards<KanbanHost>[]>(
    () =>
      cardsByHost.map(({ host, cards }) => ({
        host,
        cards: cards.filter(
          (card) =>
            activityFilters.has(card.activity) &&
            (activeProviderFilter === "all" || card.provider === activeProviderFilter),
        ),
      })),
    [cardsByHost, activityFilters, activeProviderFilter],
  );
  const totals = useMemo(
    () => ({
      hosts: visibleHosts.length,
      sessions: entries.reduce((sum, entry) => sum + entry.cards.length, 0),
    }),
    [entries, visibleHosts.length],
  );

  const openSession = useCallback(
    async (host: KanbanHost, card: SessionCard, agentId?: string) => {
      const targetAgentId = agentId ?? card.id;
      if (host.id === "local") {
        // Expand the sidebar panel first so a failure never blocks the conversation jump;
        // the agent reveal runs last and keeps final focus.
        try {
          openSessionDetail({ workspaceId: card.workspaceId, agentId: targetAgentId });
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : "Could not open session detail.");
        }
        navigation?.openAgent({ agentId: targetAgentId });
        if (card.unreadMarkedAt && !agentId) {
          toggleUnread.mutate({ agentId: card.id, marked: true });
        }
        return;
      }
      if (!host.serverId) {
        toast.error("Native navigation requires a relay pairing URL for this host.");
        return;
      }
      try {
        await openRemote.mutateAsync({ serverId: host.serverId, agentId: targetAgentId });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not open this agent in Paseo.");
      }
    },
    [navigation, openRemote, toast, toggleUnread],
  );

  const openWorkspace = useCallback(
    (host: KanbanHost, workspaceId: string) => {
      if (host.id === "local" && navigation) {
        navigation.openWorkspace({ workspaceId });
        return;
      }
      toast.error("Workspace navigation is only available on this host.");
    },
    [navigation, toast],
  );

  const archiveSessionCard = useCallback(
    (host: KanbanHost, card: SessionCard) =>
      archiveSession.mutateAsync({ hostId: host.id, agentId: card.id }),
    [archiveSession],
  );
  const toggleUnreadCard = useCallback(
    (host: KanbanHost, card: SessionCard) => {
      void host;
      toggleUnread.mutate({ agentId: card.id, marked: Boolean(card.unreadMarkedAt) });
    },
    [toggleUnread],
  );
  const renameWorkspaceCb = useCallback(
    (host: KanbanHost, workspaceId: string, title: string | null) =>
      rename.mutateAsync({ hostId: host.id, workspaceId, title }),
    [rename],
  );
  const archiveWorkspaceCb = useCallback(
    (host: KanbanHost, workspaceId: string) =>
      archiveWs.mutateAsync({ hostId: host.id, workspaceId }),
    [archiveWs],
  );

  const viewProps = {
    entries,
    theme,
    scheme,
    compact,
    nowMs: Date.now(),
    onOpenSession: openSession,
    onOpenWorkspace: openWorkspace,
    onArchiveSession: archiveSessionCard,
    onToggleUnread: toggleUnreadCard,
  };

  return (
    <View style={styles.screen}>
      <FilterBar
        theme={theme}
        scheme={scheme}
        compact={compact}
        hosts={allHosts}
        savedHosts={hosts.data?.hosts ?? []}
        hostFilter={activeFilter}
        onHostFilter={setHostFilter}
        providers={providers}
        providerFilter={activeProviderFilter}
        onProviderFilter={setProviderFilter}
        activityFilters={activityFilters}
        onToggleActivity={(activity) =>
          setActivityFilters((current) => {
            const next = new Set(current);
            if (next.has(activity)) next.delete(activity);
            else next.add(activity);
            return next;
          })
        }
        onAddHost={(name, host) => add.mutate({ name, host })}
        addPending={add.isPending}
        addError={add.error ? add.error.message : null}
        onRemoveHost={(name) => remove.mutate({ name })}
        removePending={remove.isPending}
      />

      <View style={styles.toolbar}>
        <View style={styles.viewSwitch}>
          {VIEW_OPTIONS.map((option) => {
            const selected = option.id === view;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`${option.label} view`}
                accessibilityState={{ selected }}
                onPress={() => savePrefs({ view: option.id })}
                style={[styles.viewButton, selected ? styles.viewButtonSelected : null]}
              >
                <Icon
                  name={option.icon}
                  size={13}
                  color={selected ? theme.colors.accentForeground : theme.colors.foregroundMuted}
                />
                {!compact ? (
                  <Text style={selected ? styles.viewTextSelected : styles.viewText}>{option.label}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {view === "swimlane" ? (
          <View style={styles.optionGroup}>
            {LANE_DIMENSIONS.map((dimension) => {
              const selected = dimension === laneDimension;
              return (
                <Pressable
                  key={dimension}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => savePrefs({ laneDimension: dimension })}
                  style={[styles.optionChip, selected ? styles.optionChipSelected : null]}
                >
                  <Text style={selected ? styles.optionTextSelected : styles.optionText}>
                    {LANE_DIMENSION_LABELS[dimension]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {view === "gantt" ? (
          <View style={styles.optionGroup}>
            {GANTT_WINDOW_IDS.map((windowId) => {
              const selected = windowId === ganttWindow;
              return (
                <Pressable
                  key={windowId}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => savePrefs({ ganttWindow: windowId })}
                  style={[styles.optionChip, selected ? styles.optionChipSelected : null]}
                >
                  <Text style={selected ? styles.optionTextSelected : styles.optionText}>{windowId}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.toolbarEnd}>
          <Text style={styles.summary} numberOfLines={1}>
            {snapshot.data ? `${new Date(snapshot.data.refreshedAt).toLocaleTimeString()} · ` : ""}
            {totals.hosts} hosts · {totals.sessions} sessions
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh board"
            disabled={snapshot.isFetching}
            onPress={() => void snapshot.refetch()}
            style={styles.iconButton}
          >
            {snapshot.isFetching ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Icon name="RefreshCw" size={15} color={theme.colors.foregroundMuted} />
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {snapshot.isPending ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {snapshot.error ? <Text style={styles.error}>{snapshot.error.message}</Text> : null}
        {visibleHosts
          .filter(({ reachable }) => !reachable)
          .map((entry) => (
            <View key={entry.id} style={styles.hostError}>
              <Icon name="ServerOff" size={15} color={theme.colors.statusDanger} />
              <Text style={styles.hostErrorText}>
                {entry.name}: {entry.error ?? "Host unreachable"}
              </Text>
            </View>
          ))}
        {!snapshot.isPending && totals.sessions === 0 && visibleHosts.every(({ reachable }) => reachable) ? (
          <Text style={styles.muted}>No active sessions.</Text>
        ) : null}
        {totals.sessions > 0 ? (
          view === "list" ? (
            <ListView
              {...viewProps}
              onRenameWorkspace={renameWorkspaceCb}
              onArchiveWorkspace={archiveWorkspaceCb}
            />
          ) : view === "gantt" ? (
            <GanttView {...viewProps} windowId={ganttWindow} />
          ) : (
            <SwimlaneView {...viewProps} laneDimension={laneDimension} />
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const gutter = compact ? 12 : 20;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: gutter,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    viewSwitch: {
      flexDirection: "row",
      gap: 2,
      padding: 2,
      borderRadius: 8,
      backgroundColor: theme.colors.surface1,
    },
    viewButton: {
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      borderRadius: 6,
    },
    viewButtonSelected: { backgroundColor: theme.colors.accent },
    viewText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" },
    viewTextSelected: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "700" },
    optionGroup: { flexDirection: "row", gap: 6 },
    optionChip: {
      minHeight: 26,
      justifyContent: "center",
      paddingHorizontal: 9,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    optionChipSelected: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface1 },
    optionText: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" },
    optionTextSelected: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },
    toolbarEnd: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
    summary: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
    iconButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    content: { flexGrow: 1 },
    hostError: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      margin: gutter,
      marginBottom: 0,
      padding: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.statusDanger,
      borderRadius: 8,
    },
    hostErrorText: { color: theme.colors.statusDanger, fontSize: 12, flex: 1 },
    error: { color: theme.colors.statusDanger, fontSize: 12, padding: gutter },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12, padding: gutter },
  });
}
