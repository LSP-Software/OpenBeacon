import { describe, expect, test } from "bun:test";
import {
  encryptGroupPayload,
  generateGroupEpochKey,
  PLACE_GEOMETRY_KIND,
  type PlaceGeometryV1,
} from "@openbeacon/encryption";
import {
  buildPlacePins,
  decryptPlaceGeometry,
  describePeopleHere,
  encryptPlaceGeometry,
  formatPlaceDistance,
  formatPlaceSize,
  type GroupPlace,
  hiddenGroupWithPlace,
  isPlaceEditUnchanged,
  metersBetween,
  metersPerPixel,
  peopleAtPlace,
  placeCirclePolygon,
  placeErrorMessage,
  placeRadiusFromSlider,
  shiftLatitudeByPixels,
  sliderFromPlaceRadius,
  snapPlaceRadius,
  zoomToFitPlace,
} from "./places.ts";

const home: PlaceGeometryV1 = { v: 1, latitude: 51.5, longitude: -0.12, radiusMeters: 250 };

const northOf = (meters: number) => ({
  latitude: home.latitude + meters / 111_195,
  longitude: home.longitude,
});

const storedPlace = (overrides: Partial<GroupPlace> = {}): GroupPlace => ({
  algorithm: "xchacha20poly1305",
  ciphertext: "cipher",
  createdAt: new Date(0),
  createdByUserId: "user-a",
  emoji: "🏠",
  epochId: "epoch-1",
  geometry: home,
  id: "place-1",
  kind: PLACE_GEOMETRY_KIND,
  name: "Home",
  nonce: "nonce",
  senderDeviceId: "device-a",
  updatedAt: new Date(0),
  updatedByUserId: null,
  ...overrides,
});

describe("place size", () => {
  test("rounds to the nearest 25 m and stays within 100 m to 1 km", () => {
    expect(snapPlaceRadius(262)).toBe(250);
    expect(snapPlaceRadius(263)).toBe(275);
    expect(snapPlaceRadius(12)).toBe(100);
    expect(snapPlaceRadius(4000)).toBe(1000);
  });

  test("maps the slider track onto the size range", () => {
    expect(placeRadiusFromSlider(0)).toBe(100);
    expect(placeRadiusFromSlider(1)).toBe(1000);
    expect(placeRadiusFromSlider(-0.2)).toBe(100);
    expect(placeRadiusFromSlider(0.5)).toBe(550);
    expect(sliderFromPlaceRadius(250)).toBeCloseTo(1 / 6);
    expect(placeRadiusFromSlider(sliderFromPlaceRadius(475))).toBe(475);
  });

  test("names the Small, Medium and Large stops and shows other sizes as a distance", () => {
    expect(formatPlaceSize(100, "kmh")).toBe("Small · 100 m");
    expect(formatPlaceSize(250, "kmh")).toBe("Medium · 250 m");
    expect(formatPlaceSize(500, "kmh")).toBe("Large · 500 m");
    expect(formatPlaceSize(175, "kmh")).toBe("175 m");
    expect(formatPlaceSize(1000, "kmh")).toBe("1 km");
  });

  test("shows place sizes in feet rounded to the nearest 10 for miles", () => {
    expect(formatPlaceSize(100, "mph")).toBe("Small · 330 ft");
    expect(formatPlaceSize(250, "mph")).toBe("Medium · 820 ft");
    expect(formatPlaceSize(500, "mph")).toBe("Large · 1640 ft");
    expect(formatPlaceSize(175, "mph")).toBe("570 ft");
    expect(formatPlaceSize(1000, "mph")).toBe("3280 ft");
    expect(formatPlaceDistance(100, "mph")).toBe("330 ft");
    expect(formatPlaceDistance(1000, "kmh")).toBe("1 km");
  });
});

describe("who's here", () => {
  const now = Date.parse("2026-11-15T12:00:00.000Z");
  const recent = "2026-11-15T11:58:00.000Z";

  test("counts people inside the radius once each", () => {
    const here = peopleAtPlace({
      geometry: home,
      now,
      people: [
        { ...northOf(240), timestamp: recent, userId: "sam" },
        { ...northOf(10), timestamp: recent, userId: "sam" },
        { ...northOf(260), timestamp: recent, userId: "logan" },
      ],
    });
    expect(here.map((person) => person.userId)).toEqual(["sam"]);
  });

  test("ignores locations older than 20 minutes", () => {
    expect(
      peopleAtPlace({
        geometry: home,
        now,
        people: [{ ...northOf(0), timestamp: "2026-11-15T11:39:00.000Z", userId: "sam" }],
      }),
    ).toEqual([]);
  });

  test("describes who's here", () => {
    expect(describePeopleHere([])).toBe("Nobody here now");
    expect(describePeopleHere(["Sam"])).toBe("Sam is here");
    expect(describePeopleHere(["Sam", "Logan"])).toBe("Sam and Logan are here");
    expect(describePeopleHere(["Sam", "Logan", "Pe", "Jo"])).toBe("Sam, Logan and 2 more are here");
  });

  test("measures distance on the ground", () => {
    expect(metersBetween(home, northOf(500))).toBeCloseTo(500, 0);
  });
});

describe("map pins", () => {
  test("skips hidden groups and places this phone can't read yet", () => {
    const pins = buildPlacePins({
      groups: [
        {
          canManage: true,
          id: "family",
          memberUserIds: ["user-a", "user-b"],
          name: "Family",
          places: [storedPlace(), storedPlace({ id: "syncing", geometry: null })],
        },
        {
          canManage: false,
          id: "hidden",
          memberUserIds: ["user-a"],
          name: "Hidden",
          places: [storedPlace()],
        },
        {
          canManage: false,
          id: "loading",
          memberUserIds: ["user-a"],
          name: "Loading",
          places: undefined,
        },
      ],
      hiddenGroupIds: new Set(["hidden"]),
    });
    expect(pins).toEqual([
      {
        canManage: true,
        emoji: "🏠",
        groupId: "family",
        groupName: "Family",
        id: "place-1",
        latitude: home.latitude,
        longitude: home.longitude,
        memberUserIds: ["user-a", "user-b"],
        name: "Home",
        radiusMeters: 250,
      },
    ]);
  });

  test("draws the radius circle at the right distance from the centre", () => {
    const ring = placeCirclePolygon(home).geometry.coordinates[0] ?? [];
    expect(ring.at(0)).toEqual(ring.at(-1));
    for (const [longitude, latitude] of ring) {
      expect(metersBetween(home, { latitude, longitude })).toBeCloseTo(250, -1);
    }
  });

  test("moves a latitude by screen pixels and back", () => {
    const shifted = shiftLatitudeByPixels({ latitude: 51.5, pixels: 150, zoom: 16 });
    expect(
      metersBetween({ latitude: 51.5, longitude: 0 }, { latitude: shifted, longitude: 0 }),
    ).toBeCloseTo(150 * metersPerPixel({ latitude: 51.5, zoom: 16 }), 0);
    expect(shiftLatitudeByPixels({ latitude: shifted, pixels: -150, zoom: 16 })).toBeCloseTo(
      51.5,
      6,
    );
  });

  test("keeps a shifted latitude within the map's ±85°", () => {
    expect(shiftLatitudeByPixels({ latitude: 84.99, pixels: 150, zoom: 2 })).toBe(85);
    expect(shiftLatitudeByPixels({ latitude: -84.99, pixels: -150, zoom: 2 })).toBe(-85);
  });

  test("zooms so the whole place circle fits the given width", () => {
    for (const radiusMeters of [100, 250, 1000]) {
      const zoom = zoomToFitPlace({ diameterPixels: 240, latitude: 51.5, radiusMeters });
      expect((2 * radiusMeters) / metersPerPixel({ latitude: 51.5, zoom })).toBeCloseTo(240, 6);
    }
    expect(
      zoomToFitPlace({ diameterPixels: 240, latitude: 51.5, radiusMeters: 100 }),
    ).toBeGreaterThan(zoomToFitPlace({ diameterPixels: 240, latitude: 51.5, radiusMeters: 1000 }));
  });

  test("finds the hidden group a focused place belongs to", () => {
    const groups = [
      { id: "family", name: "Family", places: [storedPlace({ id: "home" })] },
      { id: "club", name: "Club", places: [storedPlace({ id: "pitch" })] },
      { id: "loading", name: "Loading", places: undefined },
    ];
    const hiddenGroupIds = new Set(["club", "loading"]);
    expect(hiddenGroupWithPlace({ groups, hiddenGroupIds, placeId: "pitch" })?.name).toBe("Club");
    expect(hiddenGroupWithPlace({ groups, hiddenGroupIds, placeId: "home" })).toBeNull();
    expect(hiddenGroupWithPlace({ groups, hiddenGroupIds, placeId: "missing" })).toBeNull();
  });
});

describe("unchanged place edits", () => {
  const before = {
    name: "Home",
    emoji: "🏠",
    geometry: { latitude: 51.5, longitude: -0.12, radiusMeters: 250 },
  };

  test("treats the same name, emoji, size and a centre within a metre as unchanged", () => {
    expect(isPlaceEditUnchanged({ before, after: before })).toBe(true);
    expect(
      isPlaceEditUnchanged({
        before,
        after: { ...before, geometry: { ...before.geometry, latitude: 51.500_005 } },
      }),
    ).toBe(true);
  });

  test("sees any real change", () => {
    expect(isPlaceEditUnchanged({ before, after: { ...before, name: "Home 2" } })).toBe(false);
    expect(isPlaceEditUnchanged({ before, after: { ...before, emoji: "🏡" } })).toBe(false);
    expect(
      isPlaceEditUnchanged({
        before,
        after: { ...before, geometry: { ...before.geometry, radiusMeters: 300 } },
      }),
    ).toBe(false);
    expect(
      isPlaceEditUnchanged({
        before,
        after: { ...before, geometry: { ...before.geometry, latitude: 51.5001 } },
      }),
    ).toBe(false);
  });
});

describe("place geometry encryption", () => {
  const epochKey = generateGroupEpochKey();
  const encrypted = encryptPlaceGeometry({
    epochId: "epoch-1",
    epochKey,
    geometry: home,
    groupId: "family",
    senderDeviceId: "device-a",
  });
  const stored = { ...encrypted, createdAt: new Date(0) };

  test("round trips with the same group and epoch", () => {
    expect(encrypted.kind).toBe(PLACE_GEOMETRY_KIND);
    expect(decryptPlaceGeometry({ epochKey, groupId: "family", place: stored })).toEqual(home);
  });

  test("hides the size behind padding", () => {
    const far = encryptPlaceGeometry({
      epochId: "epoch-1",
      epochKey,
      geometry: { v: 1, latitude: -33.868_820_1, longitude: 151.209_295_5, radiusMeters: 1000 },
      groupId: "family",
      senderDeviceId: "device-a",
    });
    expect(far.ciphertext.length).toBe(encrypted.ciphertext.length);
  });

  test("refuses geometry moved to another group, device or key", () => {
    expect(decryptPlaceGeometry({ epochKey, groupId: "other", place: stored })).toBeNull();
    expect(
      decryptPlaceGeometry({
        epochKey,
        groupId: "family",
        place: { ...stored, senderDeviceId: "device-b" },
      }),
    ).toBeNull();
    expect(
      decryptPlaceGeometry({ epochKey: generateGroupEpochKey(), groupId: "family", place: stored }),
    ).toBeNull();
  });

  test("accepts geometry copied from another place in the same group, as it isn't bound to the place id", () => {
    const school: PlaceGeometryV1 = { v: 1, latitude: 51.6, longitude: -0.2, radiusMeters: 500 };
    const schoolCiphertext = encryptPlaceGeometry({
      epochId: "epoch-1",
      epochKey,
      geometry: school,
      groupId: "family",
      senderDeviceId: "device-a",
    });
    expect(
      decryptPlaceGeometry({
        epochKey,
        groupId: "family",
        place: { ...stored, ...schoolCiphertext },
      }),
    ).toEqual(school);
  });

  test("refuses other payload kinds and invalid geometry", () => {
    expect(
      decryptPlaceGeometry({
        epochKey,
        groupId: "family",
        place: { ...stored, kind: "trackingPoint" },
      }),
    ).toBeNull();
    const notAPlace = encryptGroupPayload({
      epochId: "epoch-1",
      epochKey,
      groupId: "family",
      kind: PLACE_GEOMETRY_KIND,
      payload: { v: 1, latitude: 51.5, longitude: -0.12, radiusMeters: 260 },
      senderDeviceId: "device-a",
    });
    expect(decryptPlaceGeometry({ epochKey, groupId: "family", place: notAPlace })).toBeNull();
  });
});

test("explains place errors in plain words", () => {
  expect(placeErrorMessage("PLACE_LIMIT_REACHED", "fallback")).toBe(
    "A group can have up to 50 places.",
  );
  expect(placeErrorMessage("EPOCH_ROTATION_PENDING", "fallback")).toContain("Try again");
  expect(placeErrorMessage(null, "fallback")).toBe("fallback");
});
