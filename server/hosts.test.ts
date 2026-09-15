import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("refuses to overwrite a malformed host registry", async () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-kanban-"));
  process.env.PASEO_HOME = home;
  const directory = join(home, "plugin-data", "paseo-kanban");
  const file = join(directory, "hosts.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, JSON.stringify({ good: "host:6767", bad: 42 }));
  const original = readFileSync(file, "utf8");
  const { addHost, readHosts } = await import(`./hosts?test=${Date.now()}`);

  assert.throws(() => readHosts(), /Invalid kanban host registry entry/);
  assert.throws(() => addHost({ name: "new", host: "new:6767" }), /Invalid kanban host registry entry/);
  assert.equal(readFileSync(file, "utf8"), original);
});
