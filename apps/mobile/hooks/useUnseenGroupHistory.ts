import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { hasUnseenGroupHistory } from "../lib/groupHistory.ts";
import { storage } from "../lib/storage.ts";

const subscribe = (onChange: () => void) => {
  const listener = storage.addOnValueChangedListener(onChange);
  return () => listener.remove();
};

export const useUnseenGroupHistory = () => {
  const isFocused = useIsFocused();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const latest = useQuery({
    ...trpc.groupHistory.latest.queryOptions(),
    subscribed: isFocused,
  });
  const unseen = useSyncExternalStore(subscribe, () =>
    userId
      ? (latest.data ?? [])
          .filter(({ groupId, latestAt }) => hasUnseenGroupHistory({ groupId, latestAt, userId }))
          .map(({ groupId }) => groupId)
          .join(",")
      : "",
  );
  return {
    latest: latest.data,
    unseenGroupIds: new Set(unseen ? unseen.split(",") : []),
    userId,
  };
};
