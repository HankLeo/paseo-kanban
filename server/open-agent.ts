import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";

// Mirrors paseo CLI findDesktopApp() (packages/cli/src/commands/open.ts).
function findDesktopApp(): string | null {
  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Paseo.app",
      path.join(homedir(), "Applications", "Paseo.app"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  if (process.platform === "linux") {
    const candidates = [
      "/usr/bin/Paseo",
      "/opt/Paseo/Paseo",
      path.join(homedir(), "Applications", "Paseo.AppImage"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      return null;
    }
    const candidate = path.join(localAppData, "Programs", "Paseo", "Paseo.exe");
    return existsSync(candidate) ? candidate : null;
  }

  return null;
}

function cleanEnvForDesktopLaunch(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Strip Electron-as-Node env so a directly spawned desktop binary starts
  // as Electron rather than a bare Node process (Linux/Windows inherit env).
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.PASEO_NODE_ENV;
  return env;
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: cleanEnvForDesktopLaunch(),
  });
  child.on("error", () => {
    // Best-effort launch; surfaced errors are handled by callers via the
    // synchronous guards above. A spawn failure here only means the desktop
    // app did not come to the foreground.
  });
  child.unref();
}

function launchDesktop(args: string[]): void {
  if (process.env.PASEO_DESKTOP_CLI === "1") {
    throw new Error("Cannot open Paseo Desktop while running in desktop CLI passthrough mode.");
  }

  const desktopApp = findDesktopApp();
  if (!desktopApp) {
    throw new Error(
      "Paseo desktop app not found. Install it from https://github.com/getpaseo/paseo/releases",
    );
  }

  if (process.platform === "darwin") {
    // -n forces a new instance even if the app is already running. The new
    // instance relays its argv to the existing one through Electron's
    // single-instance lock. -g keeps the terminal in the foreground.
    spawnDetached("open", ["-n", "-g", "-a", desktopApp, "--args", ...args]);
    return;
  }

  spawnDetached(desktopApp, args);
}

/**
 * Open an agent in the desktop app via its paseo:// deep link.
 *
 * This replaces the previous `paseo agent open --server` CLI fallback:
 * spawning a fresh Node CLI process per click added ~1s of cold-start
 * latency just to build this URL. Building the deep link inline and
 * spawning `open` detached makes the handoff near-instant.
 */
export async function openAgentInDesktop(serverId: string, agentId: string): Promise<void> {
  launchDesktop([buildAgentDeepLink({ serverId, agentId })]);
}
