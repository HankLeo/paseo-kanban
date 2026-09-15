import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { KanbanHost } from "../../shared/contracts";
import { agentActivityColor, mergedColor, type ColorScheme } from "../../shared/colors";
import { AGENT_ACTIVITY_ICONS, AGENT_ACTIVITY_LABELS, formatTimeAgo, providerIcon } from "../../shared/model";
import type { SessionCard } from "../../shared/session-model";

export interface SessionCardActions {
  onOpenSession(host: KanbanHost, card: SessionCard, agentId?: string): void;
  onOpenWorkspace(host: KanbanHost, workspaceId: string): void;
  onArchiveSession(host: KanbanHost, card: SessionCard): Promise<unknown>;
  onToggleUnread(host: KanbanHost, card: SessionCard): void;
}

interface SessionCardViewProps extends SessionCardActions {
  card: SessionCard;
  host: KanbanHost;
  theme: PluginTheme;
  scheme: ColorScheme;
  compact: boolean;
  /** Dense mode for swimlane columns: hides children list and labels. */
  dense?: boolean;
  nowMs: number;
}

export function SessionCardView(props: SessionCardViewProps) {
  const { card, host, theme, scheme, compact, dense, nowMs } = props;
  const styles = useMemo(() => createStyles(theme, compact, dense ?? false), [theme, compact, dense]);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const color = agentActivityColor(card.activity, theme, scheme);
  const risky = card.activity === "working" || card.activity === "waiting";
  const pullRequest = card.pullRequest;
  const prColor = pullRequest?.state === "merged" ? mergedColor(scheme) : theme.colors.accent;

  const archive = () => {
    setArchiving(true);
    void props
      .onArchiveSession(host, card)
      .catch(() => {})
      .finally(() => {
        setArchiving(false);
        setConfirmArchive(false);
      });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${AGENT_ACTIVITY_LABELS[card.activity]}. Open ${card.title}`}
      onPress={() => props.onOpenSession(host, card)}
      style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
    >
      <View style={[styles.colorBar, { backgroundColor: color }]} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Icon name={AGENT_ACTIVITY_ICONS[card.activity]} size={13} color={color} />
          <Text style={styles.title} numberOfLines={dense ? 1 : 2}>
            {card.title}
          </Text>
          <Text style={styles.time}>{formatTimeAgo(card.lastActivityAtMs, nowMs)}</Text>
        </View>

        <View style={styles.metaRow}>
          <Icon name={providerIcon(card.provider)} size={11} color={theme.colors.foregroundMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {card.model || card.providerName}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Icon name="Server" size={11} color={theme.colors.foregroundMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {host.name}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open workspace ${card.workspaceName}`}
            onPress={(event) => {
              event.stopPropagation?.();
              props.onOpenWorkspace(host, card.workspaceId);
            }}
            style={styles.workspaceLink}
          >
            <Icon name="Folder" size={11} color={theme.colors.accent} />
            <Text style={styles.workspaceLinkText} numberOfLines={1}>
              {card.workspaceName}
            </Text>
          </Pressable>
        </View>

        {pullRequest ? (
          <Pressable
            accessibilityRole="link"
            onPress={(event) => {
              event.stopPropagation?.();
              void Linking.openURL(pullRequest.url);
            }}
            style={styles.prRow}
          >
            <Icon name="GitPullRequest" size={11} color={prColor} />
            <Text style={[styles.prText, { color: prColor }]} numberOfLines={1}>
              PR {pullRequest.number ?? ""} · {pullRequest.state}
              {pullRequest.checks === "failed"
                ? " · checks failed"
                : pullRequest.review === "approved"
                  ? " · approved"
                  : ""}
            </Text>
          </Pressable>
        ) : null}

        {!dense && card.children.length > 0 ? (
          <View style={styles.children}>
            {card.children.slice(0, 3).map((child) => (
              <Pressable
                key={child.id}
                accessibilityRole="button"
                accessibilityLabel={`Open subagent ${child.title}`}
                onPress={(event) => {
                  event.stopPropagation?.();
                  props.onOpenSession(host, card, child.id);
                }}
                style={({ pressed }) => [styles.childRow, pressed ? styles.cardPressed : null]}
              >
                <Icon
                  name={AGENT_ACTIVITY_ICONS[child.activity]}
                  size={11}
                  color={agentActivityColor(child.activity, theme, scheme)}
                />
                <Text style={styles.childText} numberOfLines={1}>
                  {child.shortName}
                </Text>
                <Icon name="ChevronRight" size={11} color={theme.colors.foregroundMuted} />
              </Pressable>
            ))}
            {card.children.length > 3 ? (
              <Text style={styles.moreText}>+{card.children.length - 3} more subagents</Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={card.unreadMarkedAt ? "Clear unread mark" : "Mark unread"}
            onPress={(event) => {
              event.stopPropagation?.();
              props.onToggleUnread(host, card);
            }}
            style={styles.actionButton}
          >
            <Icon
              name={card.unreadMarkedAt ? "MailOpen" : "Mail"}
              size={14}
              color={card.unreadMarkedAt ? theme.colors.statusSuccess : theme.colors.foregroundMuted}
            />
          </Pressable>
          {confirmArchive ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm archive session"
                onPress={(event) => {
                  event.stopPropagation?.();
                  archive();
                }}
                style={styles.actionButton}
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
                  accessibilityLabel="Cancel archive"
                  onPress={(event) => {
                    event.stopPropagation?.();
                    setConfirmArchive(false);
                  }}
                  style={styles.actionButton}
                >
                  <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Archive ${card.title}`}
              onPress={(event) => {
                event.stopPropagation?.();
                if (risky) setConfirmArchive(true);
                else archive();
              }}
              style={styles.actionButton}
            >
              {archiving ? (
                <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
              ) : (
                <Icon name="Archive" size={14} color={theme.colors.foregroundMuted} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function createStyles(theme: PluginTheme, compact: boolean, dense: boolean) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: 8,
      backgroundColor: theme.colors.surface1,
      overflow: "hidden",
    },
    cardPressed: { backgroundColor: theme.colors.surface2 },
    colorBar: { width: 3 },
    body: { flex: 1, minWidth: 0, padding: dense ? 8 : 10, gap: 6 },
    titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
    title: { color: theme.colors.foreground, fontSize: dense ? 12 : 13, fontWeight: "600", flex: 1 },
    time: { color: theme.colors.foregroundMuted, fontSize: 10, flexShrink: 0, marginTop: 1 },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    meta: { color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 },
    workspaceLink: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, minWidth: 0 },
    workspaceLinkText: { color: theme.colors.accent, fontSize: 11 },
    prRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    prText: { fontSize: 11 },
    children: { gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 4 },
    childRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 3, paddingHorizontal: 4, borderRadius: 5 },
    childText: { color: theme.colors.foreground, fontSize: 11, flex: 1 },
    moreText: { color: theme.colors.foregroundMuted, fontSize: 10, paddingHorizontal: 4 },
    actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
    actionButton: { width: 26, height: 24, alignItems: "center", justifyContent: "center" },
  });
}
