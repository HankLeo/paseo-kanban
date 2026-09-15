import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { KanbanHost } from "../../shared/contracts";
import { agentActivityColor, type ColorScheme } from "../../shared/colors";
import {
  AGENT_ACTIVITIES,
  AGENT_ACTIVITY_ICONS,
  AGENT_ACTIVITY_LABELS,
  providerIcon,
  type AgentActivity,
} from "../../shared/model";

export interface ProviderOption {
  id: string;
  label: string;
}

export interface FilterBarProps {
  theme: PluginTheme;
  scheme: ColorScheme;
  compact: boolean;
  hosts: readonly KanbanHost[];
  savedHosts: readonly { name: string }[];
  hostFilter: string;
  onHostFilter(id: string): void;
  providers: readonly ProviderOption[];
  providerFilter: string;
  onProviderFilter(id: string): void;
  activityFilters: ReadonlySet<AgentActivity>;
  onToggleActivity(activity: AgentActivity): void;
  onAddHost(name: string, host: string): void;
  addPending: boolean;
  addError: string | null;
  onRemoveHost(name: string): void;
  removePending: boolean;
}

export function FilterBar(props: FilterBarProps) {
  const { theme, scheme, compact } = props;
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  const [showConfig, setShowConfig] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");

  const submit = () => {
    props.onAddHost(name.trim(), host.trim());
    setName("");
    setHost("");
  };

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipContent}
          style={styles.chipScroller}
        >
          {[{ id: "all", name: "All hosts", reachable: true }, ...props.hosts].map((entry) => {
            const selected = entry.id === props.hostFilter;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => props.onHostFilter(entry.id)}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                {entry.id !== "all" ? (
                  <View
                    style={[
                      styles.hostDot,
                      { backgroundColor: entry.reachable ? theme.colors.statusSuccess : theme.colors.statusDanger },
                    ]}
                  />
                ) : null}
                <Text style={selected ? styles.chipTextSelected : styles.chipText}>{entry.name}</Text>
              </Pressable>
            );
          })}
          {props.providers.length > 1 ? <View style={styles.divider} /> : null}
          {props.providers.map((provider) => {
            const selected = provider.id === props.providerFilter;
            return (
              <Pressable
                key={provider.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => props.onProviderFilter(provider.id)}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                {provider.id !== "all" ? (
                  <Icon
                    name={providerIcon(provider.id)}
                    size={12}
                    color={selected ? theme.colors.accentForeground : theme.colors.foregroundMuted}
                  />
                ) : null}
                <Text style={selected ? styles.chipTextSelected : styles.chipText}>{provider.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showConfig ? "Close add host form" : "Add host"}
          accessibilityState={{ expanded: showConfig }}
          onPress={() => setShowConfig((value) => !value)}
          style={({ pressed }) => [styles.addButton, pressed ? styles.pressed : null]}
        >
          <Icon name={showConfig ? "X" : "Plus"} size={14} color={theme.colors.accentForeground} />
          <Text style={styles.addButtonText}>{showConfig ? "Close" : "Add host"}</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipContent}
      >
        {AGENT_ACTIVITIES.map((activity) => {
          const selected = props.activityFilters.has(activity);
          const color = agentActivityColor(activity, theme, scheme);
          return (
            <Pressable
              key={activity}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => props.onToggleActivity(activity)}
              style={[
                styles.activityChip,
                selected ? { borderColor: color, backgroundColor: `${color}18` } : null,
              ]}
            >
              <Icon
                name={AGENT_ACTIVITY_ICONS[activity]}
                size={12}
                color={selected ? color : theme.colors.foregroundMuted}
              />
              <Text style={[styles.activityChipText, selected ? { color } : null]}>
                {AGENT_ACTIVITY_LABELS[activity]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {showConfig ? (
        <View style={styles.configBody}>
          <Text style={styles.sectionTitle}>Add remote host</Text>
          <Text style={styles.configHint}>
            Run `paseo daemon pair --json` on the remote host, then paste its URL here—or enter a
            direct daemon address.
          </Text>
          {props.savedHosts.map((entry) => (
            <View key={entry.name} style={styles.configRow}>
              <Text style={styles.hostName}>{entry.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${entry.name}`}
                disabled={props.removePending}
                onPress={() => props.onRemoveHost(entry.name)}
                style={styles.removeButton}
              >
                <Icon name="Trash2" size={14} color={theme.colors.statusDanger} />
              </Pressable>
            </View>
          ))}
          <TextInput
            accessibilityLabel="Remote host name"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Name"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Remote host address or pairing URL"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Pairing URL or host:port"
            placeholderTextColor={theme.colors.foregroundMuted}
            secureTextEntry
            value={host}
            onChangeText={setHost}
            style={styles.input}
          />
          {props.addError ? <Text style={styles.error}>{props.addError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!name.trim() || !host.trim() || props.addPending}
            onPress={submit}
            style={({ pressed }) => [styles.submitButton, pressed ? styles.pressed : null]}
          >
            <Text style={styles.submitButtonText}>{props.addPending ? "Adding…" : "Add host"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme: PluginTheme, compact: boolean) {
  const gutter = compact ? 12 : 20;
  return StyleSheet.create({
    bar: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface0,
    },
    row: { flexDirection: "row", alignItems: "center" },
    chipScroller: { flex: 1 },
    chipContent: { paddingHorizontal: gutter, paddingVertical: 10, gap: 7 },
    chip: {
      minHeight: 30,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      borderRadius: 15,
      backgroundColor: theme.colors.surface1,
    },
    chipSelected: { backgroundColor: theme.colors.accent },
    chipText: { color: theme.colors.foregroundMuted, fontSize: 12 },
    chipTextSelected: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "700" },
    hostDot: { width: 7, height: 7, borderRadius: 4 },
    divider: { width: 1, alignSelf: "stretch", marginVertical: 5, backgroundColor: theme.colors.border },
    activityChip: {
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 14,
    },
    activityChipText: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" },
    addButton: {
      minHeight: 30,
      marginRight: gutter,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      borderRadius: 15,
      backgroundColor: theme.colors.accent,
    },
    addButtonText: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "700" },
    configBody: {
      padding: 12,
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    },
    configHint: { color: theme.colors.foregroundMuted, fontSize: 12 },
    sectionTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "700" },
    configRow: { flexDirection: "row", alignItems: "center", minHeight: 36 },
    hostName: { color: theme.colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 },
    removeButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    input: {
      minHeight: 44,
      color: theme.colors.foreground,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
    },
    submitButton: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    submitButtonText: { color: theme.colors.accentForeground, fontWeight: "700" },
    error: { color: theme.colors.statusDanger, fontSize: 12 },
    pressed: { opacity: 0.82 },
  });
}
