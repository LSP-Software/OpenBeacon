import z from "zod";
import { alertsCursorSchema } from "../group/placeTransitions.ts";

export const accountNoticesSyncSchema = z.object({
  cursor: alertsCursorSchema.nullable(),
  pushToken: z.string().min(1).max(4096).nullable().optional(),
});
