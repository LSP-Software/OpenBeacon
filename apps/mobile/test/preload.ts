import { mock } from "bun:test";
import { createReactNativeTestModule } from "./reactNativeTestModule.ts";

mock.module("react-native", () => createReactNativeTestModule());
