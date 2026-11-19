import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { RefreshCwIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const RequestUpdateButton = ({
  hasLocation,
  locationsKey,
  name,
  onRequestUpdate,
  phones,
}: {
  hasLocation: boolean;
  locationsKey: string;
  name: string;
  onRequestUpdate: () => Promise<void>;
  phones: "devices" | "phone";
}) => {
  const [state, setState] = useState<
    "idle" | "asking" | "asked" | "noUpdate" | "rateLimited" | "failed"
  >("idle");
  const [seenLocationsKey, setSeenLocationsKey] = useState(locationsKey);
  if (locationsKey !== seenLocationsKey) {
    setSeenLocationsKey(locationsKey);
    if (state === "asked" || state === "noUpdate") setState("idle");
  }

  useEffect(() => {
    if (state !== "asked") return;
    const timer = setTimeout(() => setState("noUpdate"), 90_000);
    return () => clearTimeout(timer);
  }, [state]);

  const message =
    state === "asked"
      ? `If ${phones === "devices" ? `one of ${name}’s devices` : `${name}’s phone`} is online${hasLocation ? "" : " and sharing"}, their location should ${hasLocation ? "update" : "show"} in a minute or so.`
      : state === "noUpdate"
        ? hasLocation
          ? `No update yet. ${name}’s ${phones} might be offline.`
          : `No location yet. ${name}’s ${phones} might be offline or not sharing.`
        : state === "rateLimited"
          ? "You’ve asked for a lot of updates. Try again in a few minutes."
          : state === "failed"
            ? "Couldn’t ask for an update. Check your connection and try again."
            : null;

  return (
    <View className="mt-4 gap-2">
      <Button
        variant="secondary"
        disabled={state === "asked"}
        loading={state === "asking"}
        onPress={async () => {
          setState("asking");
          const result = await tryCatch(onRequestUpdate());
          setState(
            !result.error
              ? "asked"
              : result.error instanceof TRPCClientError &&
                  result.error.data?.code === "TOO_MANY_REQUESTS"
                ? "rateLimited"
                : "failed",
          );
        }}
      >
        <Icon as={RefreshCwIcon} size={18} className="text-foreground" />
        <Text>{state === "asked" ? "Update requested" : "Update now"}</Text>
      </Button>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          className={
            state === "rateLimited" || state === "failed"
              ? "text-destructive-text text-sm"
              : "text-secondary text-sm"
          }
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
};
