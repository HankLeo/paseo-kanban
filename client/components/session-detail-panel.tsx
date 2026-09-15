import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useAgent, usePaseo, useWorkspace } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { agentActivityColor, themeScheme } from "../../shared/colors";
import {
  AGENT_ACTIVITY_ICONS,
  AGENT_ACTIVITY_LABELS,
  deriveAgentActivity,
  formatTimeAgo,
  providerLabel,
} from "../../shared/model";

/**
 * Session detail shown in the explorer sidebar (or as a workspace tab) when a card is opened.
 * Data comes from the app session store, so it stays live without any plugin RPC.
 */
export function SessionDetailPanel({ theme, layout, workspaceId, agentId, navigation }: PluginAgentPanelProps) {
  const compact = layout.compact;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const scheme = useMemo(() => themeScheme(theme), [theme]);
  const paseo = usePaseo();
  const agent = useAgent(agentId, (snapshot) => ({
    title: snapshot.title,
    provider: snapshot.provider,
    model: snapshot.model,
    status: snapshot.status,
    requiresAttention: snapshot.requiresAttention,
    attentionReason: snapshot.attentionReason,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    parentAgentId: snapshot.parentAgentId,
  }));
  const workspace = useWorkspace(workspaceId, (snapshot) => ({
    name: snapshot.name,
    title: snapshot.title,
    status: snapshot.status,
    projectDisplayName: snapshot.projectDisplayName,
    diffStat: snapshot.diffStat,
  }));

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmAgentArchive, setConfirmAgentArchive] = useState(false);
  const [confirmWorkspaceArchive, setConfirmWorkspaceArchive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  if (!agent) {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>This session is no longer available.</Text>
      </View>
    );
  }

  const activity = deriveAgentActivity({
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
    pendingPermissions: [],
  });
  const activityColor = agentActivityColor(activity, theme, scheme);
  const title = agent.title?.trim() || providerLabel(agent.provider);
  const running = agent.status === "running" || agent.status === "initializing";

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const saveWorkspaceTitle = () =>
    run("rename", async () => {
      await paseo.workspaces.ref(workspaceId).setTitle(titleDraft.trim() || null);
      setEditingTitle(false);
    });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Icon name={AGENT_ACTIVITY_ICONS[activity]} size={16} color={activityColor} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={[styles.activityText, { color: activityColor }]}>
        {AGENT_ACTIVITY_LABELS[activity]}
        {running ? " · live" : ""}
      </Text>

      <View style={styles.section}>
        <MetaRow label="Provider" value={agent.model || providerLabel(agent.provider)} styles={styles} />
        <MetaRow label="Created" value={formatTimeAgo(Date.parse(agent.createdAt), nowMs)} styles={styles} />
        <MetaRow label="Last activity" value={formatTimeAgo(Date.parse(agent.updatedAt), nowMs)} styles={styles} />
        {agent.parentAgentId ? <MetaRow label="Subagent of" value={agent.parentAgentId} styles={styles} /> : null}
      </View>

      {workspace ? (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Workspace</Text>
            {!editingTitle ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit workspace title"
                onPress={() => {
                  setTitleDraft(workspace.title ?? workspace.name);
                  setEditingTitle(true);
                }}
                style={styles.smallButton}
              >
                <Icon name="PenLine" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : null}
          </View>
          {editingTitle ? (
            <View style={styles.titleEditor}>
              <TextInput
                accessibilityLabel="Workspace title"
                autoFocus
                maxLength={200}
                onChangeText={setTitleDraft}
                onSubmitEditing={() => void saveWorkspaceTitle()}
                returnKeyType="done"
                selectTextOnFocus
                style={styles.titleInput}
                value={titleDraft}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save workspace title"
                onPress={() => void saveWorkspaceTitle()}
                style={styles.smallButton}
              >
                {busy === "rename" ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <Icon name="Check" size={14} color={theme.colors.accent} />
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel title edit"
                onPress={() => setEditingTitle(false)}
                style={styles.smallButton}
              >
                <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          ) : (
            <MetaRow label="Name" value={workspace.name} styles={styles} />
          )}
          <MetaRow label="Project" value={workspace.projectDisplayName} styles={styles} />
          <MetaRow label="Status" value={workspace.status} styles={styles} />
          {workspace.diffStat ? (
            <MetaRow
              label="Diff"
              value={`+${workspace.diffStat.additions} −${workspace.diffStat.deletions}`}
              styles={styles}
            />
          ) : null}
        </View>
      ) : null}

      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

      <View style={styles.actions}>
        {navigation ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.openAgent({ agentId })}
            style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null]}
          >
            <Icon name="MessageSquare" size={14} color={theme.colors.accentForeground} />
            <Text style={styles.primaryButtonText}>Open conversation</Text>
          </Pressable>
        ) : null}
        {navigation ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.openWorkspace({ workspaceId })}
            style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}
          >
            <Icon name="Folder" size={14} color={theme.colors.accent} />
            <Text style={styles.secondaryButtonText}>Open workspace</Text>
          </Pressable>
        ) : null}

        {confirmAgentArchive ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void run("archive-agent", async () => {
                await paseo.agents.ref(agentId).archive();
                setConfirmAgentArchive(false);
              })
            }
            style={({ pressed }) => [styles.dangerButton, pressed ? styles.pressed : null]}
          >
            {busy === "archive-agent" ? (
              <ActivityIndicator size="small" color={theme.colors.statusDanger} />
            ) : (
              <Text style={styles.dangerButtonText}>Confirm archive session</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => (running ? setConfirmAgentArchive(true) : void run("archive-agent", () => paseo.agents.ref(agentId).archive()))}
            style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}
          >
            <Icon name="Archive" size={14} color={theme.colors.statusDanger} />
            <Text style={styles.dangerText}>Archive session</Text>
          </Pressable>
        )}

        {confirmWorkspaceArchive ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void run("archive-workspace", async () => {
                await paseo.workspaces.ref(workspaceId).archive();
                setConfirmWorkspaceArchive(false);
              })
            }
            style={({ pressed }) => [styles.dangerButton, pressed ? styles.pressed : null]}
          >
            {busy === "archive-workspace" ? (
              <ActivityIndicator size="small" color={theme.colors.statusDanger} />
            ) : (
              <Text style={styles.dangerButtonText}>Confirm archive workspace</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmWorkspaceArchive(true)}
            style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressed : null]}
          >
            <Icon name="Archive" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.secondaryButtonText}>Archive workspace</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function MetaRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(theme: PluginTheme, compact: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: compact ? 14 : 20, gap: 14 },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { color: theme.colors.foreground, fontSize: compact ? 16 : 18, fontWeight: "700", flex: 1 },
    activityText: { fontSize: 12, fontWeight: "600", marginTop: -8 },
    section: {
      gap: 6,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: 8,
      backgroundColor: theme.colors.surface1,
    },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "700" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    metaLabel: { color: theme.colors.foregroundMuted, fontSize: 12, width: 96 },
    metaValue: { color: theme.colors.foreground, fontSize: 12, flex: 1 },
    titleEditor: { flexDirection: "row", alignItems: "center", gap: 4 },
    titleInput: {
      flex: 1,
      minWidth: 0,
      height: 30,
      color: theme.colors.foreground,
      fontSize: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.accent,
      borderRadius: 5,
      paddingHorizontal: 6,
    },
    smallButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    actions: { gap: 8 },
    primaryButton: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    primaryButtonText: { color: theme.colors.accentForeground, fontWeight: "700", fontSize: 13 },
    secondaryButton: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    secondaryButtonText: { color: theme.colors.foreground, fontWeight: "600", fontSize: 13 },
    dangerText: { color: theme.colors.statusDanger, fontWeight: "600", fontSize: 13 },
    dangerButton: {
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.statusDanger,
    },
    dangerButtonText: { color: theme.colors.statusDanger, fontWeight: "700", fontSize: 13 },
    error: { color: theme.colors.statusDanger, fontSize: 12 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 13, padding: 16 },
    pressed: { opacity: 0.82 },
  });
}
