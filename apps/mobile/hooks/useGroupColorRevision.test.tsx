import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, useMemo } from "react";
import { createRoot, type Root } from "test-renderer";
import { buildLiveMapMarkers } from "../lib/buildLiveMapMarkers.ts";
import type { LiveMapPosition } from "../lib/mapTrackingTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const storageValues = new Map<string, string>();

mock.module("../lib/storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

const { GROUP_COLOR_PALETTE, getGroupColor, setGroupColor, subscribeToGroupColorChanges } =
  await import("../lib/groupColor.ts");
const { useGroupColorRevision } = await import("./useGroupColorRevision.ts");

let root: Root | null = null;
let latestRingColors: string[] = [];

const positions: LiveMapPosition[] = [
  {
    battery: { charging: false, level: 80 },
    latitude: 51.5,
    longitude: -0.12,
    sourceGroupId: "family",
    speed: null,
    timestamp: "2026-07-19T10:00:00.000Z",
    userId: "alice",
  },
  {
    battery: { charging: false, level: 80 },
    latitude: 51.51,
    longitude: -0.13,
    sourceGroupId: "family",
    speed: null,
    timestamp: "2026-07-19T10:00:00.000Z",
    userId: "bob",
  },
];

const groups = [
  {
    id: "family",
    members: [
      { image: null, name: "Alice", userId: "alice" },
      { image: null, name: "Bob", userId: "bob" },
    ],
    name: "Family",
  },
];

describe("useGroupColorRevision", () => {
  beforeEach(() => {
    storageValues.clear();
    latestRingColors = [];
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
      root = null;
    }
  });

  test("updates mounted map marker ring colors when MMKV group color changes", async () => {
    const nextColor = GROUP_COLOR_PALETTE[1];
    if (!nextColor) {
      throw new Error("expected palette color");
    }

    const initialColor = getGroupColor("family");
    expect(initialColor).not.toBe(nextColor);

    const MountedMapMarkers = () => {
      const groupColorRevision = useGroupColorRevision();
      const markers = useMemo(() => {
        void groupColorRevision;
        return buildLiveMapMarkers({
          getGroupColor,
          groups,
          positions,
          selfUserId: "self",
        });
      }, [groupColorRevision]);
      latestRingColors = markers.map((marker) => marker.ringColor);
      return null;
    };

    root = createRoot();
    await act(async () => {
      root?.render(<MountedMapMarkers />);
      await Promise.resolve();
    });

    expect(latestRingColors).toEqual([initialColor, initialColor]);

    await act(async () => {
      setGroupColor("family", nextColor);
      await Promise.resolve();
    });

    expect(latestRingColors).toEqual([nextColor, nextColor]);
  });

  test("stops notifying after the revision subscription is cleaned up", async () => {
    const nextColor = GROUP_COLOR_PALETTE[2];
    if (!nextColor) {
      throw new Error("expected palette color");
    }

    let notifications = 0;
    const unsubscribe = subscribeToGroupColorChanges(() => {
      notifications += 1;
    });
    unsubscribe();

    setGroupColor("family", nextColor);

    expect(notifications).toBe(0);
  });
});
