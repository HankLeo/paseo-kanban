import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { KanbanHost } from "../../shared/contracts";
import { agentActivityColor, type ColorScheme } from "../../shared/colors";
import {
  AGENT_ACTIVITIES,
  AGENT_ACTIVITY_ICONS,
  AGENT_ACTIVITY_LABELS,
  type AgentActivity,
} from "../../shared/model";
import {
  buildLanes,
  type HostCards,
  type Lane,
  type LaneDimension,
  type SessionCard,
} from "../../shared/session-model";
import { SessionCardView, type SessionCardActions } from "../components/session-card";

export interface SwimlaneViewProps extends SessionCardActions {
  entries: readonly HostCards<KanbanHost>[];
  laneDimension: LaneDimension;
  theme: PluginTheme;
  scheme: ColorScheme;
  compact: boolean;
  nowMs: number;
}

const COLUMN_WIDTH = 240;
const COLUMN_GAP = 10;

export function SwimlaneView(props: SwimlaneViewProps) {
  const { theme, scheme, compact, entries, laneDimension } = props;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const lanes = useMemo(() => buildLanes(entries, laneDimension), [entries, laneDimension]);

  if (compact) {
    return (
      <View style={styles.compactList}>
        {lanes.map((lane) => (
          <View key={lane.id} style={styles.compactLane}>
            <LaneHeader lane={lane} theme={theme} styles={styles} />
            {AGENT_ACTIVITIES.map((activity) => {
              const cards = lane.cards.filter((card) => card.activity === activity);
              if (cards.length === 0) return null;
              return (
                <View key={activity} style={styles.compactActivity}>
                  <View style={styles.compactActivityHeader}>
                    <Icon
                      name={AGENT_ACTIVITY_ICONS[activity]}
                      size={12}
                      color={agentActivityColor(activity, theme, scheme)}
                    />
                    <Text style={styles.compactActivityText}>
                      {AGENT_ACTIVITY_LABELS[activity]} · {cards.length}
                    </Text>
                  </View>
                  {cards.map((card) => (
                    <CardCell key={card.id} card={card} lane={lane} {...props} dense={false} />
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.boardScroller}>
      <View style={styles.board}>
        <View style={styles.columnHeaderRow}>
          {AGENT_ACTIVITIES.map((activity) => {
            const color = agentActivityColor(activity, theme, scheme);
            const count = lanes.reduce(
              (sum, lane) => sum + lane.cards.filter((card) => card.activity === activity).length,
              0,
            );
            return (
              <View key={activity} style={[styles.columnHeader, { borderTopColor: color }]}>
                <Icon name={AGENT_ACTIVITY_ICONS[activity]} size={12} color={color} />
                <Text style={[styles.columnHeaderText, { color }]}>
                  {AGENT_ACTIVITY_LABELS[activity]}
                </Text>
                <Text style={styles.columnCount}>{count}</Text>
              </View>
            );
          })}
        </View>
        {lanes.map((lane) => (
          <View key={lane.id} style={styles.lane}>
            <LaneHeader lane={lane} theme={theme} styles={styles} />
            <View style={styles.laneRow}>
              {AGENT_ACTIVITIES.map((activity) => {
                const cards = lane.cards.filter((card) => card.activity === activity);
                return (
                  <View key={activity} style={styles.cell}>
                    {cards.map((card) => (
                      <CardCell key={card.id} card={card} lane={lane} {...props} dense />
                    ))}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof createStyles>;

function LaneHeader({ lane, theme, styles }: { lane: Lane<KanbanHost>; theme: PluginTheme; styles: Styles }) {
  return (
    <View style={styles.laneHeader}>
      <Text style={styles.laneTitle} numberOfLines={1}>
        {lane.title}
      </Text>
      {lane.subtitle ? (
        <Text style={styles.laneSubtitle} numberOfLines={1}>
          {lane.subtitle}
        </Text>
      ) : null}
      <Text style={styles.laneCount}>{lane.cards.length}</Text>
    </View>
  );
}

function CardCell({
  card,
  lane,
  dense,
  ...props
}: SwimlaneViewProps & { card: SessionCard; lane: Lane<KanbanHost>; dense: boolean }) {
  return (
    <SessionCardView
      card={card}
      host={lane.host}
      theme={props.theme}
      scheme={props.scheme}
      compact={props.compact}
      dense={dense}
      nowMs={props.nowMs}
      onOpenSession={props.onOpenSession}
      onOpenWorkspace={props.onOpenWorkspace}
      onArchiveSession={props.onArchiveSession}
      onToggleUnread={props.onToggleUnread}
    />
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const gutter = compact ? 12 : 20;
  return StyleSheet.create({
    boardScroller: { padding: gutter },
    board: { gap: 14 },
    columnHeaderRow: { flexDirection: "row", gap: COLUMN_GAP },
    columnHeader: {
      width: COLUMN_WIDTH,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderTopWidth: 2,
      backgroundColor: theme.colors.surface1,
      borderRadius: 6,
    },
    columnHeaderText: { fontSize: 11, fontWeight: "700", flex: 1 },
    columnCount: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" },
    lane: { gap: 6 },
    laneHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    laneTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "700", flexShrink: 1 },
    laneSubtitle: { color: theme.colors.foregroundMuted, fontSize: 11, flex: 1 },
    laneCount: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" },
    laneRow: { flexDirection: "row", gap: COLUMN_GAP, alignItems: "flex-start" },
    cell: { width: COLUMN_WIDTH, gap: 8 },
    compactList: { padding: gutter, gap: 16 },
    compactLane: { gap: 8 },
    compactActivity: { gap: 6 },
    compactActivityHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
    compactActivityText: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "700" },
  });
}
