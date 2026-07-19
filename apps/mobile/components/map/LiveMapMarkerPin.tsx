import { View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";

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
  headingDegrees = null,
  image,
  initials,
  name,
  onBitmapContentChange,
  ringColor,
}: {
  headingDegrees?: number | null;
  image: string | null;
  initials: string;
  name: string;
  onBitmapContentChange?: () => void;
  ringColor: string;
}) => {
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
            borderColor: ringColor,
            overflow: "hidden",
            backgroundColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Avatar alt={name} className="size-10">
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
      </View>
    </View>
  );
};
