import React, { type ReactNode } from "react";

export type TestGestureHandlers = Record<string, (event: Record<string, number>) => void>;

const gestureBuilder = () => {
  const handlers: TestGestureHandlers = {};
  const builder: Record<string, unknown> = { handlers };
  for (const name of ["onBegin", "onStart", "onUpdate", "onChange", "onEnd", "onFinalize"]) {
    builder[name] = (handler: (event: Record<string, number>) => void) => {
      handlers[name] = handler;
      return builder;
    };
  }
  for (const name of [
    "activeOffsetX",
    "activeOffsetY",
    "enabled",
    "failOffsetX",
    "failOffsetY",
    "hitSlop",
    "minDistance",
    "runOnJS",
    "shouldCancelWhenOutside",
  ]) {
    builder[name] = () => builder;
  }
  return builder;
};

export const createGestureHandlerTestModule = () => ({
  Gesture: { Pan: gestureBuilder, Tap: gestureBuilder },
  GestureDetector: ({ children, gesture }: { children?: ReactNode; gesture: unknown }) =>
    React.createElement("gesture-detector", { gesture }, children),
  GestureHandlerRootView: ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement("gesture-root", props, children),
});
