import { describe, expect, test } from "bun:test";
import { resolveUsableDeviceHeading } from "./resolveUsableDeviceHeading.ts";

describe("resolveUsableDeviceHeading", () => {
  test("returns null when compass accuracy is none", () => {
    expect(
      resolveUsableDeviceHeading({
        accuracy: 0,
        magHeading: 90,
        trueHeading: 90,
      }),
    ).toBeNull();
  });

  test("returns null when compass accuracy is low", () => {
    expect(
      resolveUsableDeviceHeading({
        accuracy: 1,
        magHeading: 45,
        trueHeading: 45,
      }),
    ).toBeNull();
  });

  test("prefers true heading when accuracy is medium or better", () => {
    expect(
      resolveUsableDeviceHeading({
        accuracy: 2,
        magHeading: 10,
        trueHeading: 95,
      }),
    ).toBe(95);

    expect(
      resolveUsableDeviceHeading({
        accuracy: 3,
        magHeading: 10,
        trueHeading: 180.5,
      }),
    ).toBe(180.5);
  });

  test("falls back to magnetic heading when true heading is unavailable", () => {
    expect(
      resolveUsableDeviceHeading({
        accuracy: 2,
        magHeading: 270,
        trueHeading: -1,
      }),
    ).toBe(270);
  });

  test("returns null when neither heading is usable", () => {
    expect(
      resolveUsableDeviceHeading({
        accuracy: 3,
        magHeading: -1,
        trueHeading: -1,
      }),
    ).toBeNull();
  });

  test("normalizes degrees into the 0–360 range", () => {
    expect(
      resolveUsableDeviceHeading({
        accuracy: 3,
        magHeading: 0,
        trueHeading: 370,
      }),
    ).toBe(10);

    expect(
      resolveUsableDeviceHeading({
        accuracy: 3,
        magHeading: -20,
        trueHeading: -1,
      }),
    ).toBe(340);
  });
});
