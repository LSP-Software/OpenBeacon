import { useSyncExternalStore } from "react";
import { getGroupColorRevision, subscribeToGroupColorChanges } from "../lib/groupColor.ts";

export const useGroupColorRevision = () =>
  useSyncExternalStore(subscribeToGroupColorChanges, getGroupColorRevision, getGroupColorRevision);
