import { Pressable } from "react-native";
import { Text } from "./Text";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
};

export function Button({ title, onPress, variant = "primary", disabled = false }: Props) {
  const containerBase = "rounded-[14px] py-4 px-6 items-center justify-center";
  const labelBase = "text-base font-semibold tracking-[0.2px]";
  const variantContainer =
    variant === "primary"
      ? "bg-primary"
      : variant === "secondary"
        ? "bg-transparent border-[1.5px] border-primary"
        : "bg-transparent";
  const variantLabel =
    variant === "primary"
      ? "text-on-primary"
      : variant === "secondary"
        ? "text-primary"
        : "text-text-secondary text-sm";

  return (
    <Pressable
      className={`${containerBase} ${variantContainer}`}
      style={({ pressed }) => ({
        opacity: disabled ? 0.38 : pressed ? 0.72 : 1,
      })}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text className={`${labelBase} ${variantLabel}`}>{title}</Text>
    </Pressable>
  );
}
