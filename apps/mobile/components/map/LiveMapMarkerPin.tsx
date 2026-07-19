import { View } from "react-native";
import Svg, { Defs, LinearGradient, Polygon, Stop } from "react-native-svg";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";

const PIN_SIZE = 48;
const PIN_RADIUS = PIN_SIZE / 2;
const BEAM_INNER = PIN_RADIUS + 2;
const BEAM_HALO_LENGTH = 52;
const BEAM_CORE_LENGTH = 46;
const BEAM_HALO_HALF_ANGLE_RAD = (30 * Math.PI) / 180;
const BEAM_CORE_HALF_ANGLE_RAD = (13 * Math.PI) / 180;
const BEAM_COLOR = "#FF1464";
const OUTER_SIZE = 2 * (BEAM_INNER + BEAM_HALO_LENGTH);
const CENTER = OUTER_SIZE / 2;

const beamPoints = (length: number, halfAngleRad: number) =>
  [
    `${CENTER},${CENTER - BEAM_INNER}`,
    `${CENTER - length * Math.sin(halfAngleRad)},${CENTER - BEAM_INNER - length * Math.cos(halfAngleRad)}`,
    `${CENTER + length * Math.sin(halfAngleRad)},${CENTER - BEAM_INNER - length * Math.cos(halfAngleRad)}`,
  ].join(" ");

const HALO_POINTS = beamPoints(BEAM_HALO_LENGTH, BEAM_HALO_HALF_ANGLE_RAD);
const CORE_POINTS = beamPoints(BEAM_CORE_LENGTH, BEAM_CORE_HALF_ANGLE_RAD);

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
                id="selfHeadingBeamHalo"
                gradientUnits="userSpaceOnUse"
                x1={CENTER}
                y1={CENTER - BEAM_INNER}
                x2={CENTER}
                y2={CENTER - BEAM_INNER - BEAM_HALO_LENGTH}
              >
                <Stop offset="0%" stopColor={BEAM_COLOR} stopOpacity="0.38" />
                <Stop offset="50%" stopColor={BEAM_COLOR} stopOpacity="0.14" />
                <Stop offset="100%" stopColor={BEAM_COLOR} stopOpacity="0" />
              </LinearGradient>
              <LinearGradient
                id="selfHeadingBeamCoreLift"
                gradientUnits="userSpaceOnUse"
                x1={CENTER}
                y1={CENTER - BEAM_INNER}
                x2={CENTER}
                y2={CENTER - BEAM_INNER - BEAM_CORE_LENGTH}
              >
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.5" />
                <Stop offset="40%" stopColor="#FFFFFF" stopOpacity="0.16" />
                <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </LinearGradient>
              <LinearGradient
                id="selfHeadingBeamCore"
                gradientUnits="userSpaceOnUse"
                x1={CENTER}
                y1={CENTER - BEAM_INNER}
                x2={CENTER}
                y2={CENTER - BEAM_INNER - BEAM_CORE_LENGTH}
              >
                <Stop offset="0%" stopColor={BEAM_COLOR} stopOpacity="0.9" />
                <Stop offset="35%" stopColor={BEAM_COLOR} stopOpacity="0.48" />
                <Stop offset="100%" stopColor={BEAM_COLOR} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Polygon points={HALO_POINTS} fill="url(#selfHeadingBeamHalo)" />
            <Polygon points={CORE_POINTS} fill="url(#selfHeadingBeamCoreLift)" />
            <Polygon points={CORE_POINTS} fill="url(#selfHeadingBeamCore)" />
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
