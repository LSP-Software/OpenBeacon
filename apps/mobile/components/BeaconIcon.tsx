import { View } from "react-native";

type Props = {
  size?: number;
  color?: string;
};

export function BeaconIcon({ size = 80, color = "#FF1464" }: Props) {
  const r = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: r,
          borderWidth: 1,
          borderColor: color,
          opacity: 0.1,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.75,
          height: size * 0.75,
          borderRadius: r * 0.75,
          borderWidth: 1.5,
          borderColor: color,
          opacity: 0.25,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.52,
          height: size * 0.52,
          borderRadius: r * 0.52,
          borderWidth: 2,
          borderColor: color,
          opacity: 0.55,
        }}
      />
      <View
        style={{
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: r * 0.28,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
