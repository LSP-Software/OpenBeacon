import { describe, expect, test } from "bun:test";
import type { PlaceSearchAddress } from "../modules/openbeacon-tracking/index.ts";
import {
  placeSearchArea,
  placeSearchLabel,
  placeSearchState,
  suggestPlaceName,
} from "./placeSearch.ts";

const tescoBarnet: PlaceSearchAddress = {
  addressLine: "64-66 High St, Chipping Barnet, Barnet EN5 5SJ, UK",
  houseNumber: "64-66",
  street: "High Street",
  subLocality: "Chipping Barnet",
  locality: null,
  postcode: "EN5 5SJ",
  countryCode: "GB",
  latitude: 51.6531509,
  longitude: -0.1997625,
};

const whetstone: PlaceSearchAddress = {
  addressLine: "Whetstone, London, UK",
  houseNumber: null,
  street: null,
  subLocality: "Whetstone",
  locality: null,
  postcode: null,
  countryCode: "GB",
  latitude: 51.6300102,
  longitude: -0.1747954,
};

describe("placeSearchLabel", () => {
  test("uses the address line as the phone returned it", () => {
    expect(placeSearchLabel(tescoBarnet)).toBe(
      "64-66 High St, Chipping Barnet, Barnet EN5 5SJ, UK",
    );
    expect(placeSearchLabel(whetstone)).toBe("Whetstone, London, UK");
    expect(placeSearchLabel({ ...whetstone, addressLine: " High St, Barnet " })).toBe(
      "High St, Barnet",
    );
  });

  test("never uses the feature name when there is no address line", () => {
    expect(placeSearchLabel({ ...tescoBarnet, addressLine: null })).toBe(
      "64-66 High Street, Chipping Barnet, EN5 5SJ",
    );
    expect(placeSearchLabel({ ...whetstone, addressLine: "  " })).toBe("Whetstone");
  });
});

const edenProject: PlaceSearchAddress = {
  addressLine: "Bodelva, Par PL24 2SG, UK",
  houseNumber: null,
  street: null,
  subLocality: null,
  locality: "Bodelva",
  postcode: "PL24 2SG",
  countryCode: "GB",
  latitude: 50.3601344,
  longitude: -4.7447178,
};

const highStreet = (locality: string, latitude: number, longitude: number) => ({
  ...whetstone,
  addressLine: `High St, ${locality}, UK`,
  street: "High Street",
  subLocality: null,
  locality,
  latitude,
  longitude,
});

const northLondon = { south: 51.5, west: -0.5, north: 52, east: 0 };
const results = (...found: PlaceSearchAddress[]) => ({
  status: "results" as const,
  results: found,
});
const failed = { status: "error" as const, message: "Timed out." };

describe("placeSearchState", () => {
  test("a phone without a lookup service disables search", () => {
    expect(placeSearchState({ anywhere: { status: "unavailable" }, near: null })).toEqual({
      kind: "unavailable",
    });
    expect(
      placeSearchState({
        anywhere: { status: "unavailable" },
        near: { area: northLondon, outcome: { status: "unavailable" } },
      }),
    ).toEqual({ kind: "unavailable" });
  });

  test("a failed lookup says search isn't working", () => {
    expect(placeSearchState({ anywhere: failed, near: null })).toEqual({ kind: "error" });
    expect(
      placeSearchState({ anywhere: failed, near: { area: northLondon, outcome: failed } }),
    ).toEqual({ kind: "error" });
  });

  test("no matches says nothing was found", () => {
    expect(placeSearchState({ anywhere: results(), near: null })).toEqual({ kind: "noResults" });
    expect(
      placeSearchState({ anywhere: results(), near: { area: northLondon, outcome: results() } }),
    ).toEqual({ kind: "noResults" });
  });

  test("a single match moves straight there", () => {
    expect(placeSearchState({ anywhere: results(tescoBarnet), near: null })).toEqual({
      kind: "move",
      result: {
        distance: null,
        label: "64-66 High St, Chipping Barnet, Barnet EN5 5SJ, UK",
        latitude: 51.6531509,
        longitude: -0.1997625,
        name: null,
      },
    });
  });

  test("the same place found by both searches counts once, as near the map", () => {
    const sameShop = { ...tescoBarnet, latitude: 51.6533, longitude: -0.1999 };
    expect(
      placeSearchState({
        anywhere: results(sameShop),
        near: { area: northLondon, outcome: results(tescoBarnet) },
      }),
    ).toEqual({
      kind: "move",
      result: {
        distance: "near",
        label: "64-66 High St, Chipping Barnet, Barnet EN5 5SJ, UK",
        latitude: 51.6531509,
        longitude: -0.1997625,
        name: null,
      },
    });
  });

  test("a match found only without the area is further away", () => {
    expect(
      placeSearchState({
        anywhere: results(edenProject),
        near: { area: northLondon, outcome: results() },
      }),
    ).toMatchObject({
      kind: "move",
      result: { distance: "further", label: "Bodelva, Par PL24 2SG, UK" },
    });
  });

  test("a match inside the area is near the map whichever search found it", () => {
    expect(
      placeSearchState({
        anywhere: results(tescoBarnet),
        near: { area: northLondon, outcome: results() },
      }),
    ).toMatchObject({ kind: "move", result: { distance: "near" } });
  });

  test("different near and far matches are listed with the near ones first", () => {
    const tyldesley = highStreet("Tyldesley", 53.514544, -2.4694598);
    const manchester = highStreet("Manchester", 53.4842479, -2.2378783);
    const barnet = highStreet("Barnet", 51.652, -0.2);
    const manchesterArea = { south: 53.25, west: -2.5, north: 53.75, east: -2 };
    const state = placeSearchState({
      anywhere: results(barnet, manchester),
      near: { area: manchesterArea, outcome: results(tyldesley, manchester) },
    });
    expect(state.kind).toBe("choose");
    expect(
      state.kind === "choose" ? state.results.map(({ distance, label }) => [label, distance]) : [],
    ).toEqual([
      ["High St, Tyldesley, UK", "near"],
      ["High St, Manchester, UK", "near"],
      ["High St, Barnet, UK", "further"],
    ]);
  });

  test("one search failing still shows what the other found", () => {
    expect(
      placeSearchState({
        anywhere: failed,
        near: { area: northLondon, outcome: results(tescoBarnet) },
      }),
    ).toMatchObject({ kind: "move", result: { distance: "near" } });
    expect(
      placeSearchState({
        anywhere: results(edenProject),
        near: { area: northLondon, outcome: failed },
      }),
    ).toMatchObject({ kind: "move", result: { distance: "further" } });
  });

  test("one search failing and the other finding nothing says search isn't working", () => {
    expect(
      placeSearchState({ anywhere: results(), near: { area: northLondon, outcome: failed } }),
    ).toEqual({ kind: "error" });
  });

  test("skips results without usable coordinates", () => {
    expect(
      placeSearchState({
        anywhere: results({ ...tescoBarnet, latitude: Number.NaN }, whetstone),
        near: null,
      }),
    ).toMatchObject({ kind: "move", result: { label: "Whetstone, London, UK" } });
    expect(
      placeSearchState({ anywhere: results({ ...whetstone, latitude: 91 }), near: null }),
    ).toEqual({ kind: "noResults" });
  });
});

describe("placeSearchArea", () => {
  const view = (center: [number, number], bounds: [number, number, number, number]) => ({
    bounds,
    center,
  });

  test("snaps the map centre to a quarter-degree grid and sends a half-degree box", () => {
    expect(placeSearchArea(view([-0.13, 51.51], [-0.14, 51.5, -0.12, 51.52]))).toEqual({
      south: 51.25,
      west: -0.5,
      north: 51.75,
      east: 0,
    });
  });

  test("snaps west of Greenwich the same way", () => {
    expect(placeSearchArea(view([-2.24, 53.48], [-2.26, 53.47, -2.22, 53.49]))).toEqual({
      south: 53.25,
      west: -2.5,
      north: 53.75,
      east: -2,
    });
    expect(placeSearchArea(view([-0.125, 51.625], [-0.13, 51.62, -0.12, 51.63]))).toEqual({
      south: 51.5,
      west: -0.25,
      north: 52,
      east: 0.25,
    });
  });

  test("the same rough area goes with every spot in a grid square", () => {
    const area = placeSearchArea(view([-0.2, 51.65], [-0.21, 51.64, -0.19, 51.66]));
    expect(placeSearchArea(view([-0.15, 51.7], [-0.16, 51.69, -0.14, 51.71]))).toEqual(area);
  });

  test("uses the visible map when it's wider than the box", () => {
    expect(placeSearchArea(view([-0.1, 51.55], [-1, 51.2, 0.8, 51.9]))).toEqual({
      south: 51.2,
      west: -1,
      north: 51.9,
      east: 0.8,
    });
  });

  test("never sends an area narrower than the box", () => {
    expect(placeSearchArea(view([-0.13, 51.51], [-0.2, 51.2, -0.06, 51.82]))).toEqual({
      south: 51.2,
      west: -0.5,
      north: 51.82,
      east: 0,
    });
  });

  test("sends no area for a view across the 180th meridian", () => {
    expect(placeSearchArea(view([179.9, -17], [179.8, -17.1, -179.9, -16.9]))).toBeNull();
    expect(placeSearchArea(view([180.1, -17], [180, -17.1, 180.2, -16.9]))).toBeNull();
  });

  test("sends no area at world scale", () => {
    expect(placeSearchArea(view([0, 20], [-180, -60, 180, 80]))).toBeNull();
    expect(placeSearchArea(view([-3, 54], [-15, 49, 9, 59]))).toBeNull();
    expect(placeSearchArea(view([170, 0], [165, -5, -170, 5]))).toBeNull();
    expect(placeSearchArea(null)).toBeNull();
  });
});

describe("suggestPlaceName", () => {
  const found = (addressLine: string, name: string | null = null) => ({
    distance: null,
    label: addressLine,
    latitude: 51.5,
    longitude: -0.1,
    name,
  });

  test("suggests the search text for a named place", () => {
    expect(
      suggestPlaceName(
        " Tesco   Barnet ",
        found("64-66 High St, Chipping Barnet, Barnet EN5 5SJ, UK"),
      ),
    ).toBe("Tesco Barnet");
    expect(suggestPlaceName("Underhill School", found("215 Mays Ln, Barnet EN5 2LZ, UK"))).toBe(
      "Underhill School",
    );
  });

  test("doesn't suggest a postcode", () => {
    expect(suggestPlaceName("EN5 3DJ", found("Barnet EN5 3DJ, UK"))).toBeNull();
    expect(suggestPlaceName("en53dj", found("Barnet EN5 3DJ, UK"))).toBeNull();
    expect(suggestPlaceName("EN5", found("Barnet EN5, UK"))).toBeNull();
    expect(suggestPlaceName("SW1A 1AA", found("London SW1A 1AA, UK"))).toBeNull();
  });

  test("doesn't suggest an address that matches the result", () => {
    expect(suggestPlaceName("High Street", found("High St, Tyldesley, Manchester, UK"))).toBeNull();
    expect(
      suggestPlaceName("10 Downing Street, London", found("10 Downing St, London SW1A 2AA, UK")),
    ).toBeNull();
    expect(suggestPlaceName("12 Wood Street", found("12 Wood St, London E17 3HT, UK"))).toBeNull();
    expect(suggestPlaceName("215 mays lane", found("215 Mays Ln, Barnet EN5 2LZ, UK"))).toBeNull();
    expect(
      suggestPlaceName("Saint Mary's Road", found("St Mary's Rd, London W5 5RH, UK")),
    ).toBeNull();
  });

  test("a result's own name comes first", () => {
    expect(suggestPlaceName("Eden Pro", found("Bodelva, Par PL24 2SG, UK", "Eden Project"))).toBe(
      "Eden Project",
    );
    expect(
      suggestPlaceName("PL24 2SG", found("Bodelva, Par PL24 2SG, UK", "Eden Project")),
    ).toBeNull();
  });

  test("keeps the suggestion within the name limit", () => {
    expect(suggestPlaceName("x".repeat(80), found("Somewhere, UK"))).toHaveLength(50);
  });
});
