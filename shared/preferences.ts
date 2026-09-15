import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Board display preferences, persisted per host by the daemon's plugin settings store. */
export const boardPreferences = defineSettings({
  id: "board",
  scope: "host",
  version: 1,
  schema: z.object({
    view: z.enum(["swimlane", "list", "gantt"]).default("swimlane"),
    laneDimension: z.enum(["workspace", "host", "project"]).default("workspace"),
    ganttWindow: z.enum(["24h", "7d", "30d"]).default("7d"),
  }),
});
