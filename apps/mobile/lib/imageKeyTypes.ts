import type { RouterOutputs } from "./api.ts";

export type StoredImageKey = NonNullable<
  RouterOutputs["groupMembership"]["list"][number]["imageKey"]
>;
