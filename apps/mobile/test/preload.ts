import { mock } from "bun:test";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

Object.assign(globalThis, { __DEV__: true });

mock.module("react-native", () => createReactNativeTestModule());
