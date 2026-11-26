import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

export const useRequestUpdate = ({
  hasLocation,
  locationsKey,
  name,
  onRequestUpdate,
  phones,
}: {
  hasLocation: boolean;
  locationsKey: string;
  name: string;
  onRequestUpdate: (() => Promise<void>) | undefined;
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

  useEffect(() => {
    if (Platform.OS === "ios" && message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return {
    asked: state === "asked",
    asking: state === "asking",
    message,
    messageIsError: state === "rateLimited" || state === "failed",
    request: async () => {
      if (!onRequestUpdate) return;
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
    },
  };
};
