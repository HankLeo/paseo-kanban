import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function openAgentInDesktop(serverId: string, agentId: string): Promise<void> {
  const { PASEO_DESKTOP_CLI: _desktopCli, ...env } = process.env;
  await execFileAsync(
    "paseo",
    ["agent", "open", agentId, "--server", serverId, "--json"],
    { env, timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
}
