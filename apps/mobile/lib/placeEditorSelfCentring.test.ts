import { describe, expect, test } from "bun:test";
import { nextPlaceEditorSelfCentring } from "./placeEditorSelfCentring.ts";

describe("nextPlaceEditorSelfCentring", () => {
  test("centres on a cached position, then once more on the first live fix", () => {
    const cached = nextPlaceEditorSelfCentring({
      centredOn: "nothing",
      location: { cached: true },
      movedByUser: false,
    });
    const live = nextPlaceEditorSelfCentring({
      centredOn: "cached",
      location: { cached: false },
      movedByUser: false,
    });
    const later = nextPlaceEditorSelfCentring({
      centredOn: "live",
      location: { cached: false },
      movedByUser: false,
    });

    expect([cached, live, later]).toEqual(["cached", "live", null]);
  });

  test("centres straight on a live fix when there is no cached position", () => {
    expect(
      nextPlaceEditorSelfCentring({
        centredOn: "nothing",
        location: { cached: false },
        movedByUser: false,
      }),
    ).toBe("live");
  });

  test("does not centre again for another cached position", () => {
    expect(
      nextPlaceEditorSelfCentring({
        centredOn: "cached",
        location: { cached: true },
        movedByUser: false,
      }),
    ).toBeNull();
  });

  test("leaves the map where the user moved it", () => {
    expect(
      nextPlaceEditorSelfCentring({
        centredOn: "cached",
        location: { cached: false },
        movedByUser: true,
      }),
    ).toBeNull();
  });

  test("waits while there is no position", () => {
    expect(
      nextPlaceEditorSelfCentring({ centredOn: "nothing", location: null, movedByUser: false }),
    ).toBeNull();
  });
});
