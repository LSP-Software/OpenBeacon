import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { resolveUsableDeviceHeading } from "../lib/resolveUsableDeviceHeading.ts";
import { runForegroundPermissionedWatch } from "../lib/runForegroundPermissionedWatch.ts";
import {
  chaseHeadingToward,
  quantizeHeadingDegrees,
  shortestHeadingDelta,
  smoothHeadingSample,
} from "../lib/smoothDeviceHeading.ts";

const HEADING_PUBLISH_INTERVAL_MS = 50;
const HEADING_SETTLED_DEGREES = 0.2;

export const useSelfDeviceHeading = (enabled: boolean) => {
  const isFocused = useIsFocused();
  const [headingDegrees, setHeadingDegrees] = useState<number | null>(null);
  const displayedRef = useRef<number | null>(null);
  const publishedRef = useRef<number | null>(null);
  const targetRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !isFocused) {
      return;
    }

    displayedRef.current = null;
    publishedRef.current = null;
    targetRef.current = null;

    let animationFrame: number | null = null;
    let lastFrameAt: number | null = null;
    let lastPublishAt = 0;

    const publish = (nextDisplayed: number | null, now: number, force = false) => {
      const nextPublished = nextDisplayed === null ? null : quantizeHeadingDegrees(nextDisplayed);

      if (nextPublished === publishedRef.current) {
        return;
      }

      if (!force && nextPublished !== null && now - lastPublishAt < HEADING_PUBLISH_INTERVAL_MS) {
        return;
      }

      lastPublishAt = now;
      publishedRef.current = nextPublished;
      setHeadingDegrees(nextPublished);
    };

    const tick = (now: number) => {
      const dtSeconds =
        lastFrameAt === null ? 0 : Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;

      const nextDisplayed = chaseHeadingToward(displayedRef.current, targetRef.current, dtSeconds);
      displayedRef.current = nextDisplayed;
      publish(nextDisplayed, now, nextDisplayed === null || publishedRef.current === null);

      const settled =
        nextDisplayed !== null &&
        targetRef.current !== null &&
        Math.abs(shortestHeadingDelta(nextDisplayed, targetRef.current)) < HEADING_SETTLED_DEGREES;

      if ((nextDisplayed === null && targetRef.current === null) || settled) {
        animationFrame = null;
        lastFrameAt = null;
        return;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    const ensureTicking = () => {
      if (animationFrame !== null) {
        return;
      }

      lastFrameAt = null;
      animationFrame = requestAnimationFrame(tick);
    };

    const stopWatching = runForegroundPermissionedWatch({
      createSubscription: () =>
        Location.watchHeadingAsync((heading) => {
          const sample = resolveUsableDeviceHeading(heading);
          targetRef.current = smoothHeadingSample(targetRef.current, sample);

          if (sample === null) {
            displayedRef.current = null;
            publish(null, Date.now(), true);
            return;
          }

          ensureTicking();
        }),
      onInactive: () => {
        targetRef.current = null;
        displayedRef.current = null;
        publish(null, Date.now(), true);
      },
    });

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
      stopWatching();
    };
  }, [enabled, isFocused]);

  return headingDegrees;
};
