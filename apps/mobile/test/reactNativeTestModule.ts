import React, { type ReactNode } from "react";
import type { PlatformOSType } from "react-native";

export const createReactNativeTestModule = ({
  appState = {
    currentState: "active",
    addEventListener: () => ({
      remove: () => {},
    }),
  },
  platformOS = "ios",
}: {
  appState?: {
    currentState: string;
    addEventListener: (
      event: string,
      listener: (nextAppState: string) => void,
    ) => {
      remove: () => void;
    };
  };
  platformOS?: PlatformOSType;
} = {}) => ({
  AppState: appState,
  Button: ({
    disabled,
    onPress,
    title,
  }: {
    disabled?: boolean;
    onPress?: () => void;
    title: string;
  }) =>
    React.createElement(
      "button",
      { disabled: disabled ?? false, onClick: onPress, type: "button" },
      title,
    ),
  Platform: {
    OS: platformOS,
  },
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) =>
    React.createElement(
      "pressable",
      {
        accessibilityLabel,
        onClick: onPress,
        onPress,
      },
      children,
    ),
  View: ({ children }: { children?: ReactNode }) => React.createElement("view", null, children),
});
