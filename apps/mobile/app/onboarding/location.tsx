import { tryCatch } from "@openbeacon/shared";
import { useState } from "react";
import { Platform, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from "react-native-svg";
import {
  OnboardingScreen,
  useAdvanceOnboardingOnce,
} from "../../components/onboarding/OnboardingScreen.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { cn } from "../../lib/cn.ts";
import {
  askForImprovedLocationAccuracy,
  requestForegroundLocationPermissions,
} from "../../lib/locationPermissions.ts";
import { useColors } from "../../lib/theme.ts";
import { thisDeviceNoun } from "../../lib/thisDeviceNoun.ts";
import { useLocationPermissions } from "../../providers/LocationPermissionProvider.tsx";

const LocationStepScreen = () => {
  const { refreshLocationPermissionState } = useLocationPermissions();
  const advance = useAdvanceOnboardingOnce();
  const [asking, setAsking] = useState(false);
  const ios = Platform.OS === "ios";
  const androidVersion = Platform.OS === "android" ? Number(Platform.Version) : 0;
  const androidQuestion = `Allow OpenBeacon to access this ${thisDeviceNoun()}’s location?`;
  const prompt = ios
    ? {
        question: "Allow “OpenBeacon” to use your location?",
        buttons: ["Allow Once", "Allow While Using App", "Don’t Allow"],
        pick: "Allow While Using App",
        summary: "When asked, leave Precise on, then choose Allow While Using App.",
      }
    : androidVersion >= 31
      ? {
          question: androidQuestion,
          buttons: ["While using the app", "Only this time", "Don’t allow"],
          pick: "While using the app",
          summary: "When asked, choose Precise, then choose While using the app.",
        }
      : androidVersion === 30
        ? {
            question: androidQuestion,
            buttons: ["While using the app", "Only this time", "Deny"],
            pick: "While using the app",
            summary: "When asked, choose While using the app.",
          }
        : androidVersion === 29
          ? {
              question: androidQuestion,
              buttons: ["Allow only while using the app", "Deny"],
              pick: "Allow only while using the app",
              summary: "When asked, choose Allow only while using the app.",
            }
          : {
              question: androidQuestion,
              buttons: ["Allow", "Deny"],
              pick: "Allow",
              summary: "When asked, choose Allow.",
            };
  const showsAccuracyChoice = ios || androidVersion >= 31;

  const allow = async () => {
    setAsking(true);
    const requested = await tryCatch(requestForegroundLocationPermissions());
    const refreshed = await refreshLocationPermissionState();
    const state = refreshed ?? requested.data;
    const granted = state?.foregroundStatus === "granted";
    if (granted && !ios) await tryCatch(askForImprovedLocationAccuracy());
    setAsking(false);
    advance(granted ? "location" : ["location", "background"]);
  };

  return (
    <OnboardingScreen
      step="location"
      title="Allow your location"
      description={`${ios ? "iOS" : "Android"} will ask how OpenBeacon can use your location. Here’s what to choose.`}
      primary={{ label: "Allow location", onPress: allow, loading: asking }}
      secondary={{
        label: "Not now",
        onPress: () => advance(["location", "background"]),
        disabled: asking,
      }}
    >
      <View accessible accessibilityLabel={prompt.summary} className="gap-2">
        <Text className="text-tertiary text-center text-xs font-semibold">
          {ios ? "What iOS will show" : "What Android will show"}
        </Text>
        <View
          className="gap-4 rounded-3xl border border-border bg-secondary/60 px-4 pb-2 pt-5"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Text className="text-foreground text-center text-base leading-6">{prompt.question}</Text>
          {ios ? (
            <View className="h-32 overflow-hidden rounded-2xl">
              <MapArt shape="rect" />
              <View className="absolute left-2 top-2 flex-row flex-wrap items-center gap-1.5">
                <View className="rounded-full border-2 border-primary bg-card px-2.5 py-1">
                  <Text className="text-foreground text-xs font-semibold">Precise: On</Text>
                </View>
                <PickTag label="Leave this on" />
              </View>
            </View>
          ) : (
            showsAccuracyChoice && (
              <View className="flex-row justify-around">
                <View className="items-center gap-1.5">
                  <MapArt shape="circle" />
                  <View className="flex-row flex-wrap items-center justify-center gap-1.5">
                    <Text className="text-foreground text-sm font-bold">Precise</Text>
                    <PickTag label="Choose this" />
                  </View>
                </View>
                <View className="items-center gap-1.5 opacity-40">
                  <ApproximateArt />
                  <Text className="text-foreground text-sm">Approximate</Text>
                </View>
              </View>
            )
          )}
          <View>
            {prompt.buttons.map((button) => {
              const chosen = button === prompt.pick;
              return (
                <View
                  key={button}
                  className={cn(
                    "min-h-11 flex-row flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-border/50 py-2",
                    !chosen && "opacity-50",
                  )}
                >
                  <View
                    className={cn(
                      "rounded-full px-3 py-1",
                      chosen ? "border-2 border-primary" : "border-2 border-transparent",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm",
                        chosen ? "text-foreground font-semibold" : "text-secondary",
                      )}
                    >
                      {button}
                    </Text>
                  </View>
                  {chosen && <PickTag label={showsAccuracyChoice ? "Then this" : "Choose this"} />}
                </View>
              );
            })}
          </View>
        </View>
      </View>
      <Text className="text-secondary text-center text-sm">
        We’ll ask about location all the time next.
      </Text>
    </OnboardingScreen>
  );
};

const PickTag = ({ label }: { label: string }) => (
  <View className="rounded-full bg-primary-soft px-2.5 py-0.5">
    <Text className="text-primary-text text-xs font-bold">{label}</Text>
  </View>
);

const MapArt = ({ shape }: { shape: "circle" | "rect" }) => {
  const colors = useColors();
  const size = 96;
  const streets = [-40, -20, 0, 20, 40, 60, 80, 100, 120];
  return (
    <Svg
      width={shape === "circle" ? size : "100%"}
      height={shape === "circle" ? size : "100%"}
      viewBox={shape === "circle" ? "0 0 100 100" : "0 0 300 128"}
      preserveAspectRatio="xMidYMid slice"
    >
      <Defs>
        <ClipPath id={`map-${shape}`}>
          {shape === "circle" ? (
            <Circle cx={50} cy={50} r={48} />
          ) : (
            <Rect width={300} height={128} />
          )}
        </ClipPath>
      </Defs>
      <G clipPath={`url(#map-${shape})`}>
        <Rect width={300} height={128} fill={colors.surface} />
        {(shape === "circle" ? streets : [...streets, 140, 160, 180, 200, 220, 240, 260, 280]).map(
          (x) => (
            <G key={x}>
              <Line
                x1={x}
                y1={0}
                x2={x + 70}
                y2={128}
                stroke={colors.textMuted}
                strokeOpacity={0.3}
                strokeWidth={1.2}
              />
              <Line
                x1={x + 70}
                y1={0}
                x2={x}
                y2={128}
                stroke={colors.textMuted}
                strokeOpacity={0.3}
                strokeWidth={1.2}
              />
            </G>
          ),
        )}
      </G>
      {shape === "circle" && (
        <Circle cx={50} cy={50} r={47} fill="none" stroke={colors.primary} strokeWidth={3} />
      )}
      <G transform={shape === "circle" ? undefined : "translate(100 34)"}>
        <Path
          d="M50 30c-7 0-12 5-12 12 0 9 12 20 12 20s12-11 12-20c0-7-5-12-12-12z"
          fill={colors.primary}
        />
        <Circle cx={50} cy={42} r={4.5} fill="#FFFFFF" />
      </G>
    </Svg>
  );
};

const ApproximateArt = () => {
  const colors = useColors();
  return (
    <Svg width={96} height={96} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={48} fill={colors.surface} />
      <Path d="M10 40 Q40 30 60 60 T95 70" stroke={colors.textMuted} strokeWidth={3} fill="none" />
      <Path d="M30 5 Q45 50 40 95" stroke={colors.textMuted} strokeWidth={3} fill="none" />
    </Svg>
  );
};

export default LocationStepScreen;
