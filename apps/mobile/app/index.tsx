import { router } from "expo-router";
import { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BeaconIcon } from "../components/BeaconIcon.tsx";
import { Button } from "../components/Button.tsx";
import { authClient } from "../lib/auth-client.ts";
import { useColors } from "../lib/theme.ts";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const RING_DIAMETERS = [SCREEN_WIDTH * 1.3, SCREEN_WIDTH, SCREEN_WIDTH * 0.72, SCREEN_WIDTH * 0.46];
const RING_OPACITIES = [0.04, 0.07, 0.11, 0.16];

function LoadingScreen({ colors }: { colors: ReturnType<typeof useColors> }) {
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
    <View style={[styles.flex, styles.loadingContainer, { backgroundColor: colors.background }]}>
      <View style={styles.loadingDecor} pointerEvents="none">
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
    </View>
  );
}

export default function HomeScreen() {
  const { data: session, isPending } = authClient.useSession();
  const colors = useColors();

  if (isPending) {
    return <LoadingScreen colors={colors} />;
  }

  if (session) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
        <View style={styles.authedContainer}>
          <View style={styles.authedDecor} pointerEvents="none">
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

          <View style={styles.authedContent}>
            <BeaconIcon size={88} color={colors.primary} />
            <View style={styles.authedTextBlock}>
              <Text style={[styles.authedGreeting, { color: colors.textSecondary }]}>
                Welcome back
              </Text>
              <Text style={[styles.authedName, { color: colors.text }]}>{session.user.name}</Text>
            </View>
          </View>

          <View style={styles.authedActions}>
            <Button title="Sign Out" variant="secondary" onPress={() => authClient.signOut()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SafeAreaView style={styles.safeContent}>
          <View style={styles.bgDecorContainer} pointerEvents="none">
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

          <View style={styles.heroBlock}>
            <BeaconIcon size={96} color={colors.primary} />
            <View style={styles.titleBlock}>
              <Text style={[styles.appName, { color: colors.text }]}>OPENBEACON</Text>
              <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                Your family.{"\n"}Your data.
              </Text>
            </View>
          </View>

          <View style={styles.actionsBlock}>
            <View style={styles.actions}>
              <Button title="Sign In" onPress={() => router.push("/signIn")} />
              <Button
                title="Create Account"
                variant="secondary"
                onPress={() => router.push("/signUp")}
              />
              <Button variant="ghost" title="Test" onPress={() => router.push("/test")} />
            </View>

            <Pressable
              style={styles.serverLink}
              onPress={() => router.push("/serverUrl")}
              accessibilityRole="button"
              accessibilityLabel="Configure custom server"
            >
              <Text style={[styles.serverLinkText, { color: colors.textMuted }]}>
                Using a self-hosted server?
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  loadingDecor: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    flexGrow: 1,
  },
  safeContent: {
    flex: 1,
    paddingHorizontal: 32,
    paddingVertical: 24,
    justifyContent: "space-between",
    minHeight: 600,
  },
  bgDecorContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    top: "-15%",
  },
  heroBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
    paddingTop: 40,
  },
  titleBlock: {
    alignItems: "center",
    gap: 16,
  },
  appName: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: 6,
    textAlign: "center",
  },
  tagline: {
    fontSize: 22,
    fontWeight: "300",
    textAlign: "center",
    lineHeight: 32,
    letterSpacing: 0.3,
  },
  actionsBlock: {
    gap: 24,
    paddingBottom: 8,
  },
  actions: {
    gap: 12,
  },
  serverLink: {
    alignItems: "center",
    paddingVertical: 8,
  },
  serverLinkText: {
    fontSize: 13,
    letterSpacing: 0.2,
  },
  authedContainer: {
    flex: 1,
    paddingHorizontal: 32,
    paddingVertical: 40,
    justifyContent: "center",
    gap: 48,
  },
  authedDecor: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  authedContent: {
    alignItems: "center",
    gap: 28,
  },
  authedTextBlock: {
    alignItems: "center",
    gap: 8,
  },
  authedGreeting: {
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  authedName: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  authedActions: {
    gap: 12,
  },
});
