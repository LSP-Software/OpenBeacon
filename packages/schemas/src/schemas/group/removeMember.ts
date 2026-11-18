import z from "zod";
import { groupEpochBundleSchema } from "../auth/registerDeviceKey.ts";

export const removeGroupMemberSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  nextEpoch: groupEpochBundleSchema,
});
