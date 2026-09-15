import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { paseoHome } from "./paseo-home";

/**
 * Plugin-owned unread marks, agentId → ISO timestamp. Marks are ephemeral UI state: a corrupt
 * file degrades to no marks instead of taking the board down, and is only replaced once the
 * user marks something again.
 */

const file = join(paseoHome(), "plugin-data", "paseo-kanban", "marks.json");
/** Marks older than this are dropped on write; sessions long gone would otherwise leak entries. */
const MAX_MARK_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function readMarks(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const marks: Record<string, string> = {};
    for (const [agentId, markedAt] of Object.entries(value)) {
      if (typeof markedAt === "string" && Number.isFinite(Date.parse(markedAt))) {
        marks[agentId] = markedAt;
      }
    }
    return marks;
  } catch {
    return {};
  }
}

function writeMarks(marks: Record<string, string>): void {
  const cutoff = Date.now() - MAX_MARK_AGE_MS;
  const pruned = Object.fromEntries(
    Object.entries(marks).filter(([, markedAt]) => Date.parse(markedAt) >= cutoff),
  );
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(pruned, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

export function markUnread(agentId: string): { markedAt: string } {
  const marks = readMarks();
  const markedAt = new Date().toISOString();
  marks[agentId] = markedAt;
  writeMarks(marks);
  return { markedAt };
}

export function clearUnread(agentId: string): void {
  const marks = readMarks();
  if (!(agentId in marks)) return;
  delete marks[agentId];
  writeMarks(marks);
}
