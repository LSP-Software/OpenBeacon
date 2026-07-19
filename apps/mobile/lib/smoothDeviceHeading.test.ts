import { describe, expect, test } from "bun:test";
import {
  chaseHeadingToward,
  HEADING_PUBLISH_INTERVAL_MS,
  isHeadingChaseSettled,
  quantizeHeadingDegrees,
  resolvePublishedHeading,
  shortestHeadingDelta,
  smoothHeadingSample,
} from "./smoothDeviceHeading.ts";

describe("shortestHeadingDelta", () => {
  test("handles wraparound near 359°/0°", () => {
    expect(shortestHeadingDelta(350, 10)).toBe(20);
    expect(shortestHeadingDelta(10, 350)).toBe(-20);
    expect(shortestHeadingDelta(359, 1)).toBe(2);
  });
});

describe("smoothHeadingSample", () => {
  test("returns null when the sample is unusable", () => {
    expect(smoothHeadingSample(90, null)).toBeNull();
  });

  test("takes the first usable sample immediately", () => {
    expect(smoothHeadingSample(null, 123.4)).toBe(123.4);
  });

  test("blends noisy samples instead of jumping to them", () => {
    let smoothed: number | null = 90;

    for (const sample of [120, 60, 110, 70]) {
      smoothed = smoothHeadingSample(smoothed, sample);
    }

    expect(smoothed).not.toBeNull();
    expect(Math.abs(shortestHeadingDelta(90, smoothed ?? 90))).toBeLessThan(25);
  });
});

describe("chaseHeadingToward", () => {
  test("clears promptly when the target becomes unusable", () => {
    expect(chaseHeadingToward(90, null, 0.016)).toBeNull();
  });

  test("snaps to the first target when nothing is displayed yet", () => {
    expect(chaseHeadingToward(null, 180, 0.016)).toBe(180);
  });

  test("eases toward the target over successive frames", () => {
    let displayed: number | null = 0;

    for (let index = 0; index < 8; index += 1) {
      displayed = chaseHeadingToward(displayed, 90, 1 / 60);
    }

    expect(displayed).not.toBeNull();
    expect(displayed).toBeGreaterThan(20);
    expect(displayed).toBeLessThan(90);
  });

  test("takes the short path across the 359°/0° wrap", () => {
    let displayed: number | null = 350;

    for (let index = 0; index < 12; index += 1) {
      displayed = chaseHeadingToward(displayed, 10, 1 / 60);
    }

    expect(displayed).not.toBeNull();
    const value = displayed ?? -1;
    expect(value > 350 || value < 25).toBe(true);
    expect(Math.abs(shortestHeadingDelta(value, 10))).toBeLessThan(
      Math.abs(shortestHeadingDelta(350, 10)),
    );
  });
});

describe("quantizeHeadingDegrees", () => {
  test("keeps tenth-degree precision for gentler visual steps", () => {
    expect(quantizeHeadingDegrees(92.44)).toBe(92.4);
    expect(quantizeHeadingDegrees(92.45)).toBe(92.5);
  });
});

describe("resolvePublishedHeading", () => {
  test("publishes the first usable sample immediately", () => {
    expect(
      resolvePublishedHeading({
        displayed: 92.44,
        force: true,
        lastPublishAt: 0,
        now: 10,
        published: null,
      }),
    ).toEqual({
      lastPublishAt: 10,
      published: 92.4,
    });
  });

  test("throttles non-forced publishes inside the interval", () => {
    expect(
      resolvePublishedHeading({
        displayed: 100,
        lastPublishAt: 1_000,
        now: 1_000 + HEADING_PUBLISH_INTERVAL_MS - 1,
        published: 90,
      }),
    ).toEqual({
      lastPublishAt: 1_000,
      published: 90,
    });
  });

  test("publishes again once the throttle interval elapses", () => {
    expect(
      resolvePublishedHeading({
        displayed: 100,
        lastPublishAt: 1_000,
        now: 1_000 + HEADING_PUBLISH_INTERVAL_MS,
        published: 90,
      }),
    ).toEqual({
      lastPublishAt: 1_000 + HEADING_PUBLISH_INTERVAL_MS,
      published: 100,
    });
  });

  test("clears a published heading immediately on null", () => {
    expect(
      resolvePublishedHeading({
        displayed: null,
        force: true,
        lastPublishAt: 1_000,
        now: 1_001,
        published: 90,
      }),
    ).toEqual({
      lastPublishAt: 1_001,
      published: null,
    });
  });
});

describe("isHeadingChaseSettled", () => {
  test("reports settled when displayed is near the target", () => {
    expect(isHeadingChaseSettled(90, 90.1)).toBe(true);
    expect(isHeadingChaseSettled(90, 100)).toBe(false);
  });

  test("allows resume after settle when the target moves again", () => {
    expect(isHeadingChaseSettled(90, 90)).toBe(true);
    expect(isHeadingChaseSettled(90, 120)).toBe(false);
  });
});
