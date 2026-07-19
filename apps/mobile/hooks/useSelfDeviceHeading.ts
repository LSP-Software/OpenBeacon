import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { resolveUsableDeviceHeading } from "../lib/resolveUsableDeviceHeading.ts";
import { runForegroundPermissionedWatch } from "../lib/runForegroundPermissionedWatch.ts";
import {
  chaseHeadingToward,
  isHeadingChaseSettled,
  resolvePublishedHeading,
  smoothHeadingSample,
} from "../lib/smoothDeviceHeading.ts";

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
      const next = resolvePublishedHeading({
        displayed: nextDisplayed,
        force,
        lastPublishAt,
        now,
        published: publishedRef.current,
      });
      lastPublishAt = next.lastPublishAt;

      if (next.published === publishedRef.current) {
        return;
      }

      publishedRef.current = next.published;
      setHeadingDegrees(next.published);
    };

    const tick = (now: number) => {
      const dtSeconds =
        lastFrameAt === null ? 0 : Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;

      const nextDisplayed = chaseHeadingToward(displayedRef.current, targetRef.current, dtSeconds);
      displayedRef.current = nextDisplayed;
      publish(nextDisplayed, now, nextDisplayed === null || publishedRef.current === null);

      if (
        (nextDisplayed === null && targetRef.current === null) ||
        isHeadingChaseSettled(nextDisplayed, targetRef.current)
      ) {
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
