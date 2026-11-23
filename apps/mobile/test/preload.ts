import React from "react";
import { mock } from "bun:test";
import { createGestureHandlerTestModule } from "./gestureHandlerTestModule.ts";
import { createNativeUiTestModule } from "./nativeUiTestModule.ts";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

Object.assign(globalThis, { __DEV__: true });

mock.module("react-native", () => createReactNativeTestModule());
mock.module("react-native-gesture-handler", () => createGestureHandlerTestModule());
mock.module("expo-device", () => ({ DeviceType: { PHONE: 1, TABLET: 2 }, deviceType: 1 }));
mock.module("@expo/ui/swift-ui", () => createNativeUiTestModule("swift-ui"));
mock.module("@expo/ui/swift-ui/modifiers", () => createNativeUiTestModule("swift-ui"));
mock.module("@expo/ui/jetpack-compose", () => createNativeUiTestModule("compose"));
mock.module("@expo/ui/jetpack-compose/modifiers", () => createNativeUiTestModule("compose"));
mock.module("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("glass-view", null, children),
  isLiquidGlassAvailable: () => false,
}));
