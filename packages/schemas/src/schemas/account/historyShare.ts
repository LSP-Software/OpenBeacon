import { HistoryShare } from "@openbeacon/database/enums";
import z from "zod";

export const historyShareSchema = z.enum(HistoryShare);

export const setHistoryShareSchema = z.object({ historyShare: historyShareSchema });

export const setGroupHistoryShareSchema = z.object({
  groupId: z.string().min(1),
  historyShare: historyShareSchema.nullable(),
});
