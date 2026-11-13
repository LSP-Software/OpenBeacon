import { tryCatch } from "@openbeacon/shared";
import { Link, router, useFocusEffect, useRootNavigationState } from "expo-router";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BeaconIcon } from "../components/BeaconIcon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Text } from "../components/ui/Text.tsx";
import { authClient } from "../lib/auth-client.ts";
import { baseUrl, hasCustomServerUrl } from "../lib/currentServer.ts";
import { isThisDeviceActive } from "../lib/deviceActivation.ts";
import { ensureDeviceKeyRegistration } from "../lib/deviceKeys.ts";
import { endSession } from "../lib/endSession.ts";
import { launchRetryDelayMs } from "../lib/launchRetry.ts";
import { readSavedDeviceLink } from "../lib/savedDeviceLink.ts";
import { useColors } from "../lib/theme.ts";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const RING_DIAMETERS = [SCREEN_WIDTH * 1.3, SCREEN_WIDTH, SCREEN_WIDTH * 0.72, SCREEN_WIDTH * 0.46];
const RING_OPACITIES = [0.04, 0.07, 0.11, 0.16];

function LoadingScreen({
  children,
  colors,
}: {
  children?: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulse]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
        {RING_DIAMETERS.map((d, i) => (
          <View
            key={d}
            style={{
              position: "absolute",
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: 1,
              borderColor: colors.primary,
              opacity: RING_OPACITIES[i],
            }}
          />
        ))}
      </View>
      <Animated.View style={{ opacity: pulse }}>
        <BeaconIcon size={80} color={colors.primary} />
      </Animated.View>
      {children}
    </View>
  );
}

export default function HomeScreen() {
  const { data: session, isPending } = authClient.useSession();
  const colors = useColors();
  const rootNavigationState = useRootNavigationState();

  const [failures, setFailures] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  useFocusEffect(
    // biome-ignore lint/correctness/useExhaustiveDependencies: attempt reruns the check when the user taps Try again
    useCallback(() => {
      if (!rootNavigationState?.key || isPending || !session) {
        return;
      }

      let cancelled = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let failed = 0;
      const route = async () => {
        const savedLink = await tryCatch(ensureDeviceKeyRegistration().then(readSavedDeviceLink));
        if (cancelled) return;
        if (savedLink.data) {
          router.replace("/setup/link");
          return;
        }
        const active = await tryCatch(isThisDeviceActive());
        if (cancelled) return;
        if (active.error) {
          failed += 1;
          setFailures(failed);
          retry = setTimeout(() => void route(), launchRetryDelayMs(failed));
          return;
        }
        setFailures(0);
        router.replace(active.data ? "/(tabs)/map" : "/setup");
      };
      void route();
      return () => {
        cancelled = true;
        clearTimeout(retry);
      };
    }, [rootNavigationState?.key, session, isPending, attempt]),
  );

  const signOut = async () => {
    setSigningOut(true);
    await tryCatch(endSession({ reason: "signedOut" }));
    setSigningOut(false);
    setFailures(0);
  };

  if (isPending || session) {
    return (
      <LoadingScreen colors={colors}>
        {session && failures > 0 && (
          <View className="absolute bottom-0 left-0 right-0 gap-3 px-8 pb-12">
            <Text className="text-center text-muted" accessibilityLiveRegion="polite">
              {hasCustomServerUrl()
                ? `Couldn't connect to ${baseUrl}. Check your connection and that your server is running. Trying again automatically.`
                : "Couldn't connect to OpenBeacon. Check your connection. Trying again automatically."}
            </Text>
            <Button onPress={() => setAttempt((value) => value + 1)}>
              <Text>Try again</Text>
            </Button>
            <Button variant="outline" loading={signingOut} onPress={signOut}>
              <Text>Sign out</Text>
            </Button>
            {hasCustomServerUrl() && (
              <Link href="/serverUrl" asChild>
                <Button variant="outline">
                  <Text>Change server</Text>
                </Button>
              </Link>
            )}
          </View>
        )}
      </LoadingScreen>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName={"flex-grow"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SafeAreaView className="flex-1 px-8 py-6 justify-between min-h-[600]">
          <View
            className="absolute inset-0 items-center justify-center top-[-15%]"
            pointerEvents="none"
          >
            {RING_DIAMETERS.map((d, i) => (
              <View
                key={d}
                style={{
                  position: "absolute",
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  opacity: RING_OPACITIES[i],
                }}
                className="border-primary border"
              />
            ))}
          </View>

          <View className="flex-1 items-center justify-center gap-10 pt-10">
            <BeaconIcon size={96} color={colors.primary} />
            <View className="items-center gap-4">
              <Text className="font-bold text-5xl">OPENBEACON</Text>
              <Text className="text-xl text-muted text-center">Your family.{"\n"}Your data.</Text>
            </View>
          </View>

          <View className="gap-6 pb-8">
            <View className="gap-3">
              <Button onPress={() => router.push("/signIn")}>
                <Text>Sign In</Text>
              </Button>
              <Button variant="outline" onPress={() => router.push("/signUp")}>
                <Text>Create Account</Text>
              </Button>
            </View>

            <Pressable
              className="items-center py-2"
              onPress={() => router.push("/serverUrl")}
              accessibilityRole="button"
              accessibilityLabel="Configure custom server"
            >
              <Text className="text-sm text-muted">Using a self-hosted server?</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </ScrollView>
    </View>
  );
}
