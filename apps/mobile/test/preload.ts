import { mock } from "bun:test";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

Object.assign(globalThis, { __DEV__: true });

mock.module("react-native", () => createReactNativeTestModule());
mock.module("expo-device", () => ({ DeviceType: { PHONE: 1, TABLET: 2 }, deviceType: 1 }));
