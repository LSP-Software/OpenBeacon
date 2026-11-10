import { useMemo, useSyncExternalStore } from "react";
import {
  getHiddenMapGroupIds,
  getHiddenMapGroupsRevision,
  subscribeToHiddenMapGroups,
} from "../lib/hiddenMapGroups.ts";

export const useHiddenMapGroupIds = (userId: string | undefined) => {
  const revision = useSyncExternalStore(
    subscribeToHiddenMapGroups,
    getHiddenMapGroupsRevision,
    getHiddenMapGroupsRevision,
  );
  return useMemo(() => {
    void revision;
    return userId ? getHiddenMapGroupIds(userId) : [];
  }, [revision, userId]);
};
