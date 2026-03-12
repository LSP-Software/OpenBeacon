import type { ComponentProps } from "react";
import { Text as RNText } from "react-native";

type Props = ComponentProps<typeof RNText> & {
  className?: string;
};

export function Text({ className, ...textProps }: Props) {
  return <RNText {...textProps} className={`text-foreground ${className}`} />;
}
