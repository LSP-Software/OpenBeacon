import React, { type ReactNode } from "react";

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
  platformOS?: string;
} = {}) => ({
  AppState: appState,
  Button: ({ onPress, title }: { onPress?: () => void; title: string }) =>
    React.createElement("button", { onClick: onPress, type: "button" }, title),
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
