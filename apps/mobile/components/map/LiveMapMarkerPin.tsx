import { ClockIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { locationStaleAt } from "../../lib/locationStaleAt.ts";
import type { MapPersonStatus } from "../../lib/mapPeopleTypes.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";
import { Icon } from "../ui/Icon.tsx";

const PIN_SIZE = 48;
const PIN_RADIUS = PIN_SIZE / 2;
const SPOT_LENGTH = 42;
const SPOT_HALF_ANGLE_RAD = (18 * Math.PI) / 180;
const BEAM_COLOR = "#FF1464";
const OUTER_RADIUS = PIN_RADIUS + SPOT_LENGTH;
const OUTER_SIZE = 2 * OUTER_RADIUS;
const CENTER = OUTER_SIZE / 2;

const polar = (radius: number, angleRad: number) => ({
  x: CENTER + radius * Math.sin(angleRad),
  y: CENTER - radius * Math.cos(angleRad),
});

const leftOuter = polar(OUTER_RADIUS, -SPOT_HALF_ANGLE_RAD);
const rightOuter = polar(OUTER_RADIUS, SPOT_HALF_ANGLE_RAD);
const SPOTLIGHT_PATH = [
  `M ${CENTER} ${CENTER}`,
  `L ${leftOuter.x} ${leftOuter.y}`,
  `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 1 ${rightOuter.x} ${rightOuter.y}`,
  "Z",
].join(" ");

export const LiveMapMarkerPin = ({
  hasUnreadableUpdate = false,
  headingDegrees = null,
  image,
  initials,
  name,
  onBitmapContentChange,
  ringColor,
  ringColors,
  status,
  timestamp,
}: {
  hasUnreadableUpdate?: boolean;
  headingDegrees?: number | null;
  image: string | null;
  initials: string;
  name: string;
  onBitmapContentChange?: () => void;
  ringColor: string;
  ringColors?: string[] | undefined;
  status?: MapPersonStatus | null | undefined;
  timestamp: string | null;
}) => {
  const [, setTick] = useState(0);
  const staleAt = timestamp === null ? Number.NaN : locationStaleAt(timestamp);
  const isStale = Date.now() >= staleAt;

  useEffect(() => {
    const delay = staleAt - Date.now();
    const timer =
      delay > 0 && Number.isFinite(delay)
        ? setTimeout(() => setTick((tick) => tick + 1), delay)
        : null;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setTick((tick) => tick + 1);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      subscription.remove();
    };
  }, [staleAt]);

  useEffect(() => {
    onBitmapContentChange?.();
  }, [hasUnreadableUpdate, isStale, onBitmapContentChange]);
  const showHeading = headingDegrees !== null;
  const size = showHeading ? OUTER_SIZE : PIN_SIZE;

  return (
    <View
      collapsable={false}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      {showHeading ? (
        <View
          pointerEvents="none"
          collapsable={false}
          style={{
            position: "absolute",
            width: OUTER_SIZE,
            height: OUTER_SIZE,
            transform: [{ rotate: `${headingDegrees}deg` }],
          }}
        >
          <Svg width={OUTER_SIZE} height={OUTER_SIZE}>
            <Defs>
              <RadialGradient
                id="selfHeadingSpotlight"
                gradientUnits="userSpaceOnUse"
                cx={CENTER}
                cy={CENTER}
                rx={OUTER_RADIUS}
                ry={OUTER_RADIUS}
              >
                <Stop offset="0%" stopColor={BEAM_COLOR} stopOpacity="0.5" />
                <Stop offset="36%" stopColor={BEAM_COLOR} stopOpacity="0.4" />
                <Stop offset="70%" stopColor={BEAM_COLOR} stopOpacity="0.14" />
                <Stop offset="100%" stopColor={BEAM_COLOR} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Path d={SPOTLIGHT_PATH} fill="url(#selfHeadingSpotlight)" />
          </Svg>
        </View>
      ) : null}
      <View
        collapsable={false}
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          borderWidth: 1,
          borderColor: "#FFFFFF",
          backgroundColor: "#FFFFFF",
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 3,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 3,
            borderColor: ringColors || status ? "transparent" : ringColor,
            overflow: "hidden",
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Avatar alt={name} className="size-10" style={status ? { opacity: 0.45 } : undefined}>
            {image ? (
              <AvatarImage
                source={{ uri: image }}
                onLoadingStatusChange={(_status: "error" | "loaded") => {
                  onBitmapContentChange?.();
                }}
              />
            ) : null}
            <AvatarFallback>
              <Text className="font-bold">{initials}</Text>
            </AvatarFallback>
          </Avatar>
        </View>
        {status ? (
          <Svg width={44} height={44} style={{ position: "absolute" }} pointerEvents="none">
            <Circle
              cx={22}
              cy={22}
              r={20.5}
              fill="none"
              stroke="#8A8299"
              strokeWidth={3}
              strokeDasharray="5 4"
            />
          </Svg>
        ) : ringColors ? (
          <Svg width={44} height={44} style={{ position: "absolute" }} pointerEvents="none">
            {ringColors.map((color, index) => (
              <Circle
                key={color}
                cx={22}
                cy={22}
                r={20.5}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeDasharray={`${(2 * Math.PI * 20.5) / ringColors.length} ${2 * Math.PI * 20.5}`}
                strokeDashoffset={(-index * 2 * Math.PI * 20.5) / ringColors.length}
                rotation={-90}
                origin="22, 22"
              />
            ))}
          </Svg>
        ) : null}
        {status === "cantLocate" ? (
          <View
            accessibilityLabel="Location unknown"
            className="absolute bottom-0 left-0 size-5 items-center justify-center rounded-full border border-border bg-card"
          >
            <Text className="text-[12px] font-bold leading-[14px] text-foreground">?</Text>
          </View>
        ) : status === "cantRead" || hasUnreadableUpdate ? (
          <View
            accessibilityLabel={
              status === "cantRead" ? "Can’t read location" : "Newer location can’t be read"
            }
            className="absolute bottom-0 left-0 size-5 items-center justify-center rounded-full border border-border bg-destructive"
          >
            <Text className="text-[12px] font-bold leading-[14px] text-destructive-foreground">
              !
            </Text>
          </View>
        ) : isStale ? (
          <View
            accessibilityLabel="Location is over 10 minutes old"
            className="absolute bottom-0 left-0 size-5 items-center justify-center rounded-full border border-border bg-card"
          >
            <Icon as={ClockIcon} size={13} className="text-foreground" />
          </View>
        ) : null}
      </View>
    </View>
  );
};
