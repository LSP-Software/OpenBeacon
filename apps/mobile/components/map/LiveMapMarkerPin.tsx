import { View } from "react-native";
import Svg, { Defs, LinearGradient, Polygon, Stop } from "react-native-svg";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";

const PIN_SIZE = 48;
const PIN_RADIUS = PIN_SIZE / 2;
const BEAM_INNER = PIN_RADIUS + 2;
const BEAM_LENGTH = 40;
const BEAM_HALF_ANGLE_RAD = (38 * Math.PI) / 180;
const OUTER_SIZE = 2 * (BEAM_INNER + BEAM_LENGTH);
const CENTER = OUTER_SIZE / 2;
const BEAM_POINTS = [
  `${CENTER},${CENTER - BEAM_INNER}`,
  `${CENTER - BEAM_LENGTH * Math.sin(BEAM_HALF_ANGLE_RAD)},${CENTER - BEAM_INNER - BEAM_LENGTH * Math.cos(BEAM_HALF_ANGLE_RAD)}`,
  `${CENTER + BEAM_LENGTH * Math.sin(BEAM_HALF_ANGLE_RAD)},${CENTER - BEAM_INNER - BEAM_LENGTH * Math.cos(BEAM_HALF_ANGLE_RAD)}`,
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
              <LinearGradient
                id="selfHeadingBeam"
                gradientUnits="userSpaceOnUse"
                x1={CENTER}
                y1={CENTER - BEAM_INNER}
                x2={CENTER}
                y2={CENTER - BEAM_INNER - BEAM_LENGTH}
              >
                <Stop offset="0%" stopColor="#FF1464" stopOpacity="0.45" />
                <Stop offset="70%" stopColor="#FF1464" stopOpacity="0.14" />
                <Stop offset="100%" stopColor="#FF1464" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Polygon points={BEAM_POINTS} fill="url(#selfHeadingBeam)" />
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
                onLoadingStatusChange={() => {
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
