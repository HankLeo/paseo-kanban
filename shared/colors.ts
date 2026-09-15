import type { PluginTheme } from "@getpaseo/plugin";
import type { AgentActivity } from "./model";

/**
 * Color tables mirrored from Paseo's identity palette so label chips and project initials look
 * the same here as in the sidebar. `PluginTheme` has no scheme flag, so darkness is read off
 * the surface color it does supply.
 */

export type ColorScheme = "light" | "dark";

export type WorkspaceLabelColor =
  | "violet"
  | "sky"
  | "emerald"
  | "orange"
  | "pink"
  | "indigo"
  | "teal"
  | "red"
  | "amber"
  | "blue";

const IDENTITY_COLOR_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const satisfies readonly WorkspaceLabelColor[];

/** Fill behind a white initial. */
const IDENTITY_FILL: Record<WorkspaceLabelColor, string> = {
  violet: "#7a6aa8",
  sky: "#3d7ea6",
  emerald: "#388068",
  orange: "#a4673a",
  pink: "#b05c80",
  indigo: "#6a70b8",
  teal: "#368080",
  red: "#b06260",
  amber: "#8f7838",
  blue: "#5179b0",
};

export function identityFill(name: WorkspaceLabelColor): string {
  return IDENTITY_FILL[name];
}

/** The same hue at 10% alpha, for the ground behind a label chip. */
export function identityTint(name: WorkspaceLabelColor): string {
  return `${IDENTITY_FILL[name]}1a`;
}

function hashKey(key: string): number {
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

/** Same hash the app uses, so a project's generated icon color matches the sidebar. */
export function deriveIdentityColorName(key: string): WorkspaceLabelColor {
  return IDENTITY_COLOR_NAMES[hashKey(key) % IDENTITY_COLOR_NAMES.length] ?? "blue";
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1] ?? "";
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((character) => character + character)
      .join("");
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function themeScheme(theme: PluginTheme): ColorScheme {
  const luminance = relativeLuminance(theme.colors.surface0);
  if (luminance === null) return "dark";
  return luminance < 0.4 ? "dark" : "light";
}

/** Status colors the plugin theme does not expose, taken from the app's palette per scheme. */
const STATUS_RUNNING = { light: "#268ae0", dark: "#5caaf6" } as const;
const STATUS_MERGED = { light: "#7347af", dark: "#a890d5" } as const;

export function runningColor(scheme: ColorScheme): string {
  return STATUS_RUNNING[scheme];
}

export function mergedColor(scheme: ColorScheme): string {
  return STATUS_MERGED[scheme];
}

export function agentActivityColor(
  activity: AgentActivity,
  theme: PluginTheme,
  scheme: ColorScheme,
): string {
  switch (activity) {
    case "waiting":
      return theme.colors.statusWarning;
    case "unread":
      return theme.colors.statusSuccess;
    case "working":
      return runningColor(scheme);
    case "failing":
      return theme.colors.statusDanger;
    case "idle":
      return theme.colors.foregroundMuted;
  }
}
