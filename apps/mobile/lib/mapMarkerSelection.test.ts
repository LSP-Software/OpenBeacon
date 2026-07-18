import { describe, expect, test } from "bun:test";
import { nextMapMarkerSelection } from "./mapMarkerSelection.ts";

describe("nextMapMarkerSelection", () => {
  test("selects a marker when nothing is selected", () => {
    expect(nextMapMarkerSelection(null, "alice")).toBe("alice");
  });

  test("clears selection when tapping the selected marker again", () => {
    expect(nextMapMarkerSelection("alice", "alice")).toBe(null);
  });

  test("switches selection when tapping a different marker", () => {
    expect(nextMapMarkerSelection("alice", "bob")).toBe("bob");
  });

  test("clears selection when tapping the map", () => {
    expect(nextMapMarkerSelection("alice", null)).toBe(null);
  });
});
