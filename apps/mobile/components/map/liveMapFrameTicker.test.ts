import { afterEach, beforeEach, expect, test } from "bun:test";
import { subscribeToLiveMapFrames } from "./liveMapFrameTicker.ts";

const frames = new Map<number, () => void>();
let lastFrame = 0;
const realAnimationFrames = {
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  requestAnimationFrame: globalThis.requestAnimationFrame,
};

const runFrame = () => {
  const due = [...frames.values()];
  frames.clear();
  for (const frame of due) frame();
};

beforeEach(() => {
  frames.clear();
  Object.assign(globalThis, {
    cancelAnimationFrame: (frame: number) => {
      frames.delete(frame);
    },
    requestAnimationFrame: (callback: () => void) => {
      lastFrame += 1;
      frames.set(lastFrame, callback);
      return lastFrame;
    },
  });
});

afterEach(() => {
  Object.assign(globalThis, realAnimationFrames);
});

test("many pins share one animation frame, which stops once the last one leaves", () => {
  const ticks: string[] = [];
  const stopAlice = subscribeToLiveMapFrames(() => ticks.push("alice"));
  const stopBob = subscribeToLiveMapFrames(() => ticks.push("bob"));
  expect(frames.size).toBe(1);

  runFrame();
  expect(ticks).toEqual(["alice", "bob"]);
  expect(frames.size).toBe(1);

  stopAlice();
  runFrame();
  expect(ticks).toEqual(["alice", "bob", "bob"]);

  stopBob();
  expect(frames.size).toBe(0);
});

test("a pin that stops during a frame isn't called again and doesn't keep frames running", () => {
  const ticks: string[] = [];
  const stopBob = subscribeToLiveMapFrames(() => ticks.push("bob"));
  const stopAlice = subscribeToLiveMapFrames(() => {
    ticks.push("alice");
    stopAlice();
    stopBob();
  });

  runFrame();
  expect(ticks).toEqual(["bob", "alice"]);
  expect(frames.size).toBe(0);

  const stopCarol = subscribeToLiveMapFrames(() => ticks.push("carol"));
  expect(frames.size).toBe(1);
  stopCarol();
});
