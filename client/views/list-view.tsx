import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { KanbanHost } from "../../shared/contracts";
import {
  agentActivityColor,
  deriveIdentityColorName,
  identityFill,
  type ColorScheme,
} from "../../shared/colors";
import { projectInitial } from "../../shared/model";
import { buildLanes, type HostCards, type Lane } from "../../shared/session-model";
import { SessionCardView, type SessionCardActions } from "../components/session-card";

export interface ListViewProps extends SessionCardActions {
  entries: readonly HostCards<KanbanHost>[];
  theme: PluginTheme;
  scheme: ColorScheme;
  compact: boolean;
  nowMs: number;
  onRenameWorkspace(host: KanbanHost, workspaceId: string, title: string | null): Promise<unknown>;
  onArchiveWorkspace(host: KanbanHost, workspaceId: string): Promise<unknown>;
}

export function ListView(props: ListViewProps) {
  const { theme, compact, entries } = props;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const lanes = useMemo(() => buildLanes(entries, "workspace"), [entries]);
  const multiHost = entries.length > 1;

  return (
    <View style={styles.list}>
      {lanes.map((lane) => (
        <WorkspaceSection
          key={lane.id}
          lane={lane}
          multiHost={multiHost}
          {...props}
          styles={styles}
        />
      ))}
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function WorkspaceSection({
  lane,
  multiHost,
  styles,
  ...props
}: ListViewProps & { lane: Lane<KanbanHost>; multiHost: boolean; styles: Styles }) {
  const { theme, nowMs } = props;
  const firstCard = lane.cards[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lane.title);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const colorName = deriveIdentityColorName(firstCard?.projectId || lane.title);

  const saveTitle = async () => {
    if (saving || !lane.workspaceId) return;
    setSaving(true);
    try {
      await props.onRenameWorkspace(lane.host, lane.workspaceId, draft.trim() || null);
      setEditing(false);
    } catch {
      // The mutation toast reports the error; keep the editor open for retry.
    } finally {
      setSaving(false);
    }
  };

  const archive = () => {
    if (!lane.workspaceId) return;
    setArchiving(true);
    void props
      .onArchiveWorkspace(lane.host, lane.workspaceId)
      .catch(() => {})
      .finally(() => {
        setArchiving(false);
        setConfirmArchive(false);
      });
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.projectIcon, { backgroundColor: identityFill(colorName) }]}>
          <Text style={styles.projectInitial}>{projectInitial(lane.subtitle ?? lane.title)}</Text>
        </View>
        {editing ? (
          <View style={styles.titleEditor}>
            <TextInput
              accessibilityLabel="Workspace title"
              autoFocus
              maxLength={200}
              onChangeText={setDraft}
              onSubmitEditing={() => void saveTitle()}
              returnKeyType="done"
              selectTextOnFocus
              style={styles.titleInput}
              value={draft}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save workspace title"
              disabled={saving}
              onPress={() => void saveTitle()}
              style={styles.headerButton}
            >
              {saving ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : (
                <Icon name="Check" size={14} color={theme.colors.accent} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel title edit"
              disabled={saving}
              onPress={() => {
                setDraft(lane.title);
                setEditing(false);
              }}
              style={styles.headerButton}
            >
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {lane.title}
            </Text>
            {lane.subtitle ? (
              <Text style={styles.sectionSubtitle} numberOfLines={1}>
                {lane.subtitle}
              </Text>
            ) : null}
            {lane.host.reachable && lane.workspaceId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit title for ${lane.title}`}
                onPress={() => {
                  setDraft(lane.title);
                  setEditing(true);
                }}
                style={styles.headerButton}
              >
                <Icon name="PenLine" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            ) : null}
          </>
        )}
        <View style={styles.sectionMeta}>
          {multiHost ? (
            <Text style={styles.sectionMetaText}>{lane.host.name}</Text>
          ) : null}
          {firstCard?.branch ? (
            <View style={styles.branchMeta}>
              <Icon name="GitBranch" size={11} color={theme.colors.foregroundMuted} />
              <Text style={styles.sectionMetaText}>{firstCard.branch}</Text>
            </View>
          ) : null}
          <Text style={styles.countText}>{lane.cards.length}</Text>
          {lane.host.reachable && lane.workspaceId ? (
            confirmArchive ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Confirm archive workspace"
                  onPress={archive}
                  style={styles.headerButton}
                >
                  {archiving ? (
                    <ActivityIndicator size="small" color={theme.colors.statusDanger} />
                  ) : (
                    <Icon name="Check" size={14} color={theme.colors.statusDanger} />
                  )}
                </Pressable>
                {!archiving ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel archive workspace"
                    onPress={() => setConfirmArchive(false)}
                    style={styles.headerButton}
                  >
                    <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Archive workspace ${lane.title}`}
                onPress={() => setConfirmArchive(true)}
                style={styles.headerButton}
              >
                <Icon name="Archive" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            )
          ) : null}
        </View>
      </View>
      <View style={styles.sectionCards}>
        {lane.cards.map((card) => (
          <SessionCardView
            key={card.id}
            card={card}
            host={lane.host}
            theme={props.theme}
            scheme={props.scheme}
            compact={props.compact}
            nowMs={nowMs}
            onOpenSession={props.onOpenSession}
            onOpenWorkspace={props.onOpenWorkspace}
            onArchiveSession={props.onArchiveSession}
            onToggleUnread={props.onToggleUnread}
          />
        ))}
      </View>
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const gutter = compact ? 12 : 20;
  return StyleSheet.create({
    list: { padding: gutter, gap: 16 },
    section: { gap: 8 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    projectIcon: { width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center" },
    projectInitial: { color: "#ffffff", fontSize: 11, fontWeight: "800" },
    sectionTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "700", flexShrink: 1 },
    sectionSubtitle: { color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 },
    sectionMeta: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
    sectionMetaText: { color: theme.colors.foregroundMuted, fontSize: 11 },
    branchMeta: { flexDirection: "row", alignItems: "center", gap: 3 },
    countText: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" },
    titleEditor: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 3 },
    titleInput: {
      flex: 1,
      minWidth: 0,
      height: 28,
      color: theme.colors.foreground,
      fontSize: 14,
      fontWeight: "600",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.accent,
      borderRadius: 5,
      paddingHorizontal: 6,
    },
    headerButton: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    sectionCards: { gap: 8 },
  });
}
