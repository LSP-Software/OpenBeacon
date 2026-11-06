import { tryCatch } from "@openbeacon/shared";
import { useEffect } from "react";
import { Alert, AppState } from "react-native";
import { trpcClient } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";

export const DeletionCancellationNotice = () => {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let checking = false;
    let showing = false;
    const check = async () => {
      if (!active || checking || showing) return;
      checking = true;
      const result = await tryCatch(trpcClient.account.deletionCancellationNotice.query());
      checking = false;
      if (!active || !result.data?.cancelled) return;
      showing = true;
      Alert.alert(
        "Account deletion cancelled",
        "Your account will not be deleted.",
        [
          {
            text: "OK",
            onPress: () => {
              if (!active) return;
              void (async () => {
                await tryCatch(
                  trpcClient.account.acknowledgeDeletionCancellation.mutate({ userId }),
                );
                if (active) showing = false;
              })();
            },
          },
        ],
        { cancelable: false },
      );
    };
    void check();
    const interval = setInterval(() => void check(), 30_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [userId]);

  return null;
};
