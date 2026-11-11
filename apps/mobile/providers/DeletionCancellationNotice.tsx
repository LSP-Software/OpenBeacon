import { Alert } from "../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { useEffect } from "react";
import { AppState } from "react-native";
import { trpcClient } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { useThisDeviceState } from "../lib/deviceActivation.ts";

export const DeletionCancellationNotice = () => {
  const { data: session } = authClient.useSession();
  const thisDeviceActive = useThisDeviceState() === "active";
  const userId = thisDeviceActive ? session?.user.id : undefined;

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
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [userId]);

  return null;
};
