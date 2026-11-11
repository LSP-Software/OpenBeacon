import { afterEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import type { MapPeople, MapPerson } from "../../lib/mapPeopleTypes.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const now = Date.parse("2026-07-19T12:00:00.000Z");

mock.module("react-native", () => ({
  ActivityIndicator: () => React.createElement("activity-indicator"),
  Pressable: ({
    accessibilityLabel,
    children,
  }: {
    accessibilityLabel?: string;
    children?: React.ReactNode;
  }) => React.createElement("pressable", { accessibilityLabel }, children),
  ScrollView: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("scroll-view", null, children),
  View: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("view", null, children),
}));
mock.module("../ui/Text.tsx", () => ({
  Text: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("text", null, children),
}));
mock.module("./LiveMapMarkerPin.tsx", () => ({
  LiveMapMarkerPin: ({ status }: { status?: string | null }) =>
    React.createElement("pin", { status: status ?? "none" }),
}));
const { LiveMapPeopleTray } = await import("./LiveMapPeopleTray.tsx");

const person = (userId: string, name: string): MapPerson => ({
  groupNames: ["Family"],
  image: null,
  initials: name.slice(0, 2),
  isSelf: false,
  name,
  userId,
});

const marker = (userId: string, name: string, minutesAgo: number): LiveMapMarker => ({
  battery: null,
  image: null,
  initials: name.slice(0, 2),
  isSelf: false,
  latitude: 0,
  longitude: 0,
  name,
  otherSharedGroupNames: [],
  ringColor: "#FF1464",
  sourceGroupId: "group-1",
  timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
  userId,
});

const emptyPeople: MapPeople = {
  cantLocate: [],
  cantRead: [],
  connectionLost: false,
  finding: [],
  hidden: [],
  outOfDate: [],
  upToDate: [],
  waiting: [],
};

const renderTray = async (people: Partial<MapPeople>) => {
  root = createRoot();
  await act(async () => {
    root?.render(
      <LiveMapPeopleTray
        now={now}
        people={{ ...emptyPeople, ...people }}
        onHeightChange={() => {}}
        onSelectPerson={() => {}}
      />,
    );
  });
  return JSON.stringify(root.container.toJSON());
};

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
});

describe("LiveMapPeopleTray", () => {
  test("shows finding and waiting people at the same time", async () => {
    const output = await renderTray({
      finding: [person("a", "Alice"), person("b", "Bob"), person("c", "Cara")],
      waiting: [person("d", "Dan")],
    });
    expect(output).toContain('"Finding"," ","3 people"');
    expect(output).toContain('"Waiting for"," ","1 person"');
    expect(output).toContain("Waiting for connection");
  });

  test("shows the offline notice only when the connection is lost", async () => {
    expect(await renderTray({ waiting: [person("d", "Dan")] })).not.toContain(
      "Can’t reach the server",
    );
    expect(
      await renderTray({ connectionLost: true, upToDate: [marker("a", "Alice Smith", 2)] }),
    ).toContain("Can’t reach the server. Locations shown may be out of date.");
  });

  test("lists people from hidden groups last, with a hidden badge", async () => {
    const output = await renderTray({
      hidden: [{ ...person("t", "Tom"), hiddenGroups: [{ id: "club", name: "Club" }] }],
      upToDate: [marker("a", "Alice Smith", 2)],
    });
    expect(output).toContain('"1"," ","hidden"');
    expect(output.indexOf('"Hidden"')).toBeGreaterThan(output.indexOf('"Up to date"'));
    expect(output).toContain("Tom, hidden");
    expect(output).toContain('"status":"hidden"');
  });

  test("matches the needs attention chip to the number of people", async () => {
    const unreadable = (userId: string, name: string) => ({
      ...person(userId, name),
      groupId: "group-1",
      groupName: "Family",
      reason: "groupKey" as const,
    });
    const one = await renderTray({ cantRead: [unreadable("a", "Alice")] });
    expect(one).toContain('"1"," ","needs attention"');
    expect(one).toContain("Show 1 needs attention");
    const two = await renderTray({ cantRead: [unreadable("a", "Alice"), unreadable("b", "Bob")] });
    expect(two).toContain('"2"," ","need attention"');
    expect(two).toContain("Show 2 need attention");
    expect(two).toContain("Needs attention");
  });

  test("hides empty sections and labels people with first names and ages", async () => {
    const output = await renderTray({
      cantLocate: [{ ...person("me", "Sam King"), isSelf: true }, person("n", "Nan")],
      outOfDate: [marker("m", "Mum Jones", 47)],
    });
    expect(output).not.toContain("Up to date");
    expect(output).not.toContain("Needs attention");
    expect(output).toContain("Mum Jones, out of date, updated 47 minutes ago");
    expect(output).toContain('"Mum"');
    expect(output).toContain('"47m"');
    expect(output).toContain("Nan, can’t locate");
    expect(output).toContain("You, can’t locate");
    expect(output).not.toContain('"Sam"');
    expect(output).toContain('"status":"cantLocate"');
  });
});
