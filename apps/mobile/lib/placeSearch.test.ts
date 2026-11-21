import { describe, expect, test } from "bun:test";
import type { PlaceSearchAddress } from "../modules/openbeacon-tracking/index.ts";
import { placeSearchLabel, placeSearchState } from "./placeSearch.ts";

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
  test("uses the address line without the country", () => {
    expect(placeSearchLabel(tescoBarnet)).toBe("64-66 High St, Chipping Barnet, Barnet EN5 5SJ");
  });

  test("keeps an area-only result readable", () => {
    expect(placeSearchLabel(whetstone)).toBe("Whetstone, London");
  });

  test("keeps a postcode in the last part of the line", () => {
    expect(
      placeSearchLabel({
        ...tescoBarnet,
        addressLine: "1600 Amphitheatre Pkwy, Mountain View, CA 94043",
      }),
    ).toBe("1600 Amphitheatre Pkwy, Mountain View, CA 94043");
  });

  test("never uses the feature name when there is no address line", () => {
    expect(placeSearchLabel({ ...tescoBarnet, addressLine: null })).toBe(
      "64-66 High Street, Chipping Barnet, EN5 5SJ",
    );
    expect(placeSearchLabel({ ...whetstone, addressLine: "  " })).toBe("Whetstone");
  });
});

describe("placeSearchState", () => {
  test("a phone without a lookup service disables search", () => {
    expect(placeSearchState({ status: "unavailable" })).toEqual({ kind: "unavailable" });
  });

  test("a failed lookup says search isn't working", () => {
    expect(placeSearchState({ status: "error", message: "timeout" })).toEqual({ kind: "error" });
  });

  test("no matches says nothing was found", () => {
    expect(placeSearchState({ status: "results", results: [] })).toEqual({ kind: "noResults" });
  });

  test("moves to the first result with its label", () => {
    expect(placeSearchState({ status: "results", results: [tescoBarnet, whetstone] })).toEqual({
      kind: "move",
      label: "64-66 High St, Chipping Barnet, Barnet EN5 5SJ",
      latitude: 51.6531509,
      longitude: -0.1997625,
    });
  });

  test("skips results without usable coordinates", () => {
    expect(
      placeSearchState({
        status: "results",
        results: [{ ...tescoBarnet, latitude: Number.NaN }, whetstone],
      }),
    ).toMatchObject({ kind: "move", label: "Whetstone, London" });
    expect(
      placeSearchState({ status: "results", results: [{ ...whetstone, latitude: 91 }] }),
    ).toEqual({ kind: "noResults" });
  });
});
