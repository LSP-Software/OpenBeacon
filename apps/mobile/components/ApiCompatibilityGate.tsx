import { Link, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, BackHandler, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getApiCompatibility,
  refreshApiCompatibility,
  refreshApiCompatibilityInBackground,
  useApiCompatibility,
} from "../lib/apiCompatibility.ts";
import { baseUrl, getBaseUrl, hasCustomServerUrl } from "../lib/currentServer.ts";
import { dismissNotice } from "../lib/notifications.ts";
import { openPlayStore } from "../lib/openPlayStore.ts";
import { appVersion } from "../lib/versions.ts";
import { Button } from "./ui/Button.tsx";
import { Text } from "./ui/Text.tsx";

export const useApiCompatibilityGateShown = () => {
  const compatibility = useApiCompatibility();
  const pathname = usePathname();
  return compatibility !== null && pathname !== "/serverUrl" && pathname !== "/account/contact-us";
};

export const ApiCompatibilityGate = () => {
  const compatibility = useApiCompatibility();
  const shown = useApiCompatibilityGateShown();
  const [checking, setChecking] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const selfHosted = hasCustomServerUrl();
  const switchedServer = getBaseUrl() !== baseUrl;
  const problem = compatibility?.problem ?? null;
  const title =
    problem === "appTooOld"
      ? "Update Open Beacon"
      : problem === "serverTooOld"
        ? selfHosted
          ? "Your server needs updating"
          : "We're updating Open Beacon"
        : "The app and server don't match";

  useEffect(() => {
    void refreshApiCompatibility({ userRequested: false });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (getApiCompatibility()) void refreshApiCompatibility({ userRequested: false });
      else void refreshApiCompatibilityInBackground();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setUnreachable(false);
    if (!problem) void dismissNotice("compatibility");
  }, [problem]);

  useEffect(() => {
    if (!shown) return;
    AccessibilityInfo.announceForAccessibility(title);
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [shown, title]);

  if (!compatibility || !shown) return null;

  const tryAgain = async () => {
    setUnreachable(false);
    setChecking(true);
    const verdict = await refreshApiCompatibility({ userRequested: true });
    setChecking(false);
    setUnreachable(verdict === null);
  };

  const serverVersion = compatibility.serverVersion ?? "unknown";

  return (
    <View className="absolute inset-0 bg-background" accessibilityViewIsModal>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="flex-grow justify-center px-8 py-10 gap-10">
          <View className="gap-5">
            <Text className="font-bold text-4xl" accessibilityRole="header">
              {title}
            </Text>
            {switchedServer ? (
              <Text className="text-lg">
                You've switched server. Close Open Beacon and open it again to connect.
              </Text>
            ) : (
              <>
                {compatibility.problem === "appTooOld" && (
                  <Text className="text-lg">
                    This version of Open Beacon is out of date, so your family can't see your
                    location. Update the app to start sharing again.
                  </Text>
                )}
                {compatibility.problem === "serverTooOld" && (
                  <Text className="text-lg">
                    {selfHosted
                      ? "Your Open Beacon server is out of date, so your location isn't being shared. Ask whoever runs your server to update it."
                      : "We're updating Open Beacon's servers. Your location isn't being shared right now. Try again in a little while."}
                  </Text>
                )}
                {compatibility.problem === "outOfSync" && (
                  <Text className="text-lg">
                    Open Beacon asked your server for something it doesn't have. Please tell us, and
                    include the versions below.
                  </Text>
                )}
              </>
            )}
            {compatibility.message !== null && (
              <Text className="text-lg">{compatibility.message}</Text>
            )}
            <View className="bg-primary/10 rounded-lg p-4 border border-primary/15 gap-1">
              <Text className="text-sm text-muted">App version {appVersion}</Text>
              {selfHosted && <Text className="text-sm text-muted">Server {baseUrl}</Text>}
              {compatibility.problem !== "appTooOld" && (
                <Text className="text-sm text-muted">Server version {serverVersion}</Text>
              )}
            </View>
            {compatibility.problem === "serverTooOld" && selfHosted && (
              <Link
                href="https://github.com/LSP-Software/OpenBeacon#run-the-backend"
                className="text-primary-text"
              >
                How to update a self-hosted server
              </Link>
            )}
          </View>

          <View className="gap-3">
            {compatibility.problem === "appTooOld" && (
              <Button onPress={() => void openPlayStore()}>
                <Text>Update</Text>
              </Button>
            )}
            {!switchedServer && (
              <Button variant="outline" loading={checking} onPress={tryAgain}>
                <Text>Try again</Text>
              </Button>
            )}
            {unreachable && !switchedServer && (
              <Text className="text-muted" accessibilityLiveRegion="polite">
                Couldn't reach your server. Check your internet connection and try again.
              </Text>
            )}
            {compatibility.problem === "outOfSync" && (
              <Link href="/account/contact-us" asChild>
                <Button variant="outline">
                  <Text>Contact us</Text>
                </Button>
              </Link>
            )}
            <Link href="/serverUrl" asChild>
              <Button variant="outline">
                <Text>Use a different server</Text>
              </Button>
            </Link>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};
