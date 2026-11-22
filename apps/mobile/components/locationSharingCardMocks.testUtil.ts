import { mock } from "bun:test";
import React from "react";

export const mockLocationSharingCardUi = () => {
  const Host = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    React.createElement("host", props, children);
  mock.module("./ui/BottomSheet.tsx", () => ({
    BottomSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
      visible ? children : null,
  }));
  mock.module("../lib/theme.ts", () => ({
    useColors: () => ({ palette: { "primary-text": "#000000", "text-secondary": "#000000" } }),
  }));
  mock.module("./ui/SegmentedControl.tsx", () => ({ SegmentedControl: Host }));
  mock.module("./ui/Switch.tsx", () => ({
    Switch: ({
      accessibilityLabel,
      value,
      onValueChange,
    }: {
      accessibilityLabel: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
    }) =>
      React.createElement(
        "mock-button",
        { onPress: () => onValueChange(!value), accessibilityState: { checked: value } },
        accessibilityLabel,
      ),
  }));
  mock.module("./ui/List.tsx", () => ({
    ListSection: ({
      title,
      footer,
      children,
    }: {
      title?: string;
      footer?: React.ReactNode;
      children?: React.ReactNode;
    }) => React.createElement("host", null, title, children, footer),
    ListRow: ({
      title,
      subtitle,
      selected,
      onPress,
      accessibilityRole,
      leading,
      trailing,
    }: {
      title: string;
      subtitle?: string;
      selected?: boolean;
      onPress?: () => void;
      accessibilityRole?: string;
      leading?: React.ReactNode;
      trailing?: React.ReactNode;
    }) =>
      React.createElement(
        onPress ? "mock-button" : "host",
        { onPress, accessibilityRole, accessibilityState: { checked: selected === true } },
        leading,
        title,
        subtitle,
        trailing,
      ),
  }));
};
