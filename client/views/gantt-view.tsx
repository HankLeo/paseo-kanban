import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { KanbanHost } from "../../shared/contracts";
import { agentActivityColor, type ColorScheme } from "../../shared/colors";
import { AGENT_ACTIVITY_ICONS, AGENT_ACTIVITY_LABELS } from "../../shared/model";
import {
  buildGanttSections,
  ganttWindowMs,
  type GanttBar,
  type GanttSection,
  type GanttWindowId,
  type HostCards,
} from "../../shared/session-model";
import type { SessionCardActions } from "../components/session-card";

export interface GanttViewProps extends SessionCardActions {
  entries: readonly HostCards<KanbanHost>[];
  windowId: GanttWindowId;
  theme: PluginTheme;
  scheme: ColorScheme;
  compact: boolean;
  nowMs: number;
}

/** Headroom past now, so working bars do not touch the right edge and the now line shows. */
const NOW_HEADROOM = 1.04;
const TICK_COUNT = 5;

export function GanttView(props: GanttViewProps) {
  const { theme, scheme, compact, entries, windowId, nowMs } = props;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const windowMs = ganttWindowMs(windowId);
  const windowStart = nowMs - windowMs;
  const totalMs = windowMs * NOW_HEADROOM;
  const labelWidth = compact ? 96 : 170;
  const chartWidth = (compact ? 480 : 720) + (windowId === "30d" ? 160 : windowId === "7d" ? 80 : 0);
  const scale = chartWidth / totalMs;
  const sections = useMemo(
    () => buildGanttSections(entries, windowId, nowMs),
    [entries, windowId, nowMs],
  );
  const multiHost = entries.length > 1;
  const nowLeft = labelWidth + windowMs * scale;

  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, index) => {
        const at = windowStart + (windowMs * index) / (TICK_COUNT - 1);
        return { at, label: formatTick(at, windowId) };
      }),
    [windowStart, windowMs, windowId],
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroller}>
      <View style={[styles.board, { width: labelWidth + chartWidth + 12 }]}>
        <View style={[styles.row, styles.headerRow]}>
          <View style={{ width: labelWidth }} />
          {ticks.map((tick, index) => (
            <Text
              key={tick.at}
              style={[styles.tickLabel, index === TICK_COUNT - 1 ? styles.tickLabelLast : null]}
            >
              {tick.label}
            </Text>
          ))}
        </View>
        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            multiHost={multiHost}
            labelWidth={labelWidth}
            chartWidth={chartWidth}
            windowStart={windowStart}
            scale={scale}
            theme={theme}
            scheme={scheme}
            styles={styles}
            onOpenSession={props.onOpenSession}
          />
        ))}
        <View pointerEvents="none" style={[styles.nowLine, { left: nowLeft }]} />
      </View>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof createStyles>;

function Section({
  section,
  multiHost,
  labelWidth,
  chartWidth,
  windowStart,
  scale,
  theme,
  scheme,
  styles,
  onOpenSession,
}: {
  section: GanttSection<KanbanHost>;
  multiHost: boolean;
  labelWidth: number;
  chartWidth: number;
  windowStart: number;
  scale: number;
  theme: PluginTheme;
  scheme: ColorScheme;
  styles: Styles;
  onOpenSession: SessionCardActions["onOpenSession"];
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {section.title}
        </Text>
        <Text style={styles.sectionSubtitle} numberOfLines={1}>
          {[section.subtitle, multiHost ? section.host.name : null].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {section.bars.map((bar) => (
        <BarRow
          key={bar.card.id}
          bar={bar}
          host={section.host}
          labelWidth={labelWidth}
          chartWidth={chartWidth}
          windowStart={windowStart}
          scale={scale}
          theme={theme}
          scheme={scheme}
          styles={styles}
          onOpenSession={onOpenSession}
        />
      ))}
    </View>
  );
}

function BarRow({
  bar,
  host,
  labelWidth,
  chartWidth,
  windowStart,
  scale,
  theme,
  scheme,
  styles,
  onOpenSession,
}: {
  bar: GanttBar;
  host: KanbanHost;
  labelWidth: number;
  chartWidth: number;
  windowStart: number;
  scale: number;
  theme: PluginTheme;
  scheme: ColorScheme;
  styles: Styles;
  onOpenSession: SessionCardActions["onOpenSession"];
}) {
  const { card } = bar;
  const color = agentActivityColor(card.activity, theme, scheme);
  const left = Math.max(0, (bar.startMs - windowStart) * scale);
  const width = Math.max(5, (bar.endMs - bar.startMs) * scale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${AGENT_ACTIVITY_LABELS[card.activity]}. Open ${card.title}`}
      onPress={() => onOpenSession(host, card)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={[styles.labelCell, { width: labelWidth }]}>
        <Icon name={AGENT_ACTIVITY_ICONS[card.activity]} size={11} color={color} />
        <Text style={styles.labelText} numberOfLines={1}>
          {card.shortName}
        </Text>
      </View>
      <View style={[styles.chartCell, { width: chartWidth }]}>
        <View style={[styles.bar, { left, width, backgroundColor: `${color}55`, borderColor: color }]} />
      </View>
    </Pressable>
  );
}

function formatTick(timestampMs: number, windowId: GanttWindowId): string {
  const date = new Date(timestampMs);
  if (windowId === "24h") {
    const hours = `${date.getHours()}`.padStart(2, "0");
    return `${hours}:00`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const gutter = compact ? 12 : 20;
  return StyleSheet.create({
    scroller: { padding: gutter },
    board: { position: "relative" },
    row: { flexDirection: "row", alignItems: "center" },
    rowPressed: { backgroundColor: theme.colors.surface1 },
    headerRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, paddingBottom: 4 },
    tickLabel: { color: theme.colors.foregroundMuted, fontSize: 10, flex: 1 },
    tickLabelLast: { textAlign: "right" },
    section: { paddingTop: 10 },
    sectionHeader: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingBottom: 4 },
    sectionTitle: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700", flexShrink: 1 },
    sectionSubtitle: { color: theme.colors.foregroundMuted, fontSize: 10, flex: 1 },
    labelCell: { flexDirection: "row", alignItems: "center", gap: 5, paddingRight: 8, height: 26 },
    labelText: { color: theme.colors.foreground, fontSize: 11, flex: 1 },
    chartCell: { height: 26, justifyContent: "center" },
    bar: { position: "absolute", height: 12, borderRadius: 6, borderWidth: 1 },
    nowLine: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: theme.colors.accent,
      opacity: 0.7,
    },
  });
}
