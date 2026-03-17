import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BeaconIcon } from "../components/BeaconIcon.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Text } from "../components/ui/Text.tsx";
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
    </View>
  );
}

export default function HomeScreen() {
  const { data: session, isPending } = authClient.useSession();
  const colors = useColors();

  useEffect(() => {
    if (!isPending && session) {
      router.replace("/(tabs)/map");
    }
  }, [session, isPending]);

  if (isPending || session) {
    return <LoadingScreen colors={colors} />;
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
