import { Pressable, StyleSheet, Text } from "react-native";
import { useColors } from "../lib/theme.ts";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
};

export function Button({ title, onPress, variant = "primary", disabled = false }: Props) {
  const colors = useColors();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && { backgroundColor: colors.primary },
        variant === "secondary" && {
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderColor: colors.primary,
        },
        variant === "ghost" && { backgroundColor: "transparent" },
        pressed && { opacity: 0.72 },
        disabled && { opacity: 0.38 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text
        style={[
          styles.label,
          variant === "primary" && { color: colors.onPrimary },
          variant === "secondary" && { color: colors.primary },
          variant === "ghost" && { color: colors.textSecondary, fontSize: 14 },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
