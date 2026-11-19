import { describe, expect, test } from "bun:test";
import { ownedDeviceName } from "./ownedDeviceName.ts";

const label = (deviceName: string, ownerNames: readonly string[], isYou = false) =>
  ownedDeviceName({ deviceName, ownerNames, isYou });

describe("ownedDeviceName", () => {
  test("puts the owner in front of a plain phone name", () => {
    expect(label("Pixel 8", ["Alice"])).toBe("Alice’s Pixel 8");
    expect(label("Pixel 8", ["Alice"], true)).toBe("Your Pixel 8");
    expect(label("Pixel 8", [])).toBe("Someone’s Pixel 8");
    expect(label("Pixel 8", ["  "])).toBe("Someone’s Pixel 8");
  });

  test("swaps the owner's possessive for the name this phone shows", () => {
    expect(label("Alice's Pixel", ["Alice"])).toBe("Alice’s Pixel");
    expect(label("alice’s pixel", ["Alice"])).toBe("Alice’s pixel");
    expect(label("Alice's Pixel", ["Alice"], true)).toBe("Your Pixel");
    expect(label("Alice's Pixel", ["Mum", "Alice"])).toBe("Mum’s Pixel");
    expect(label("Alice's Pixel", ["Alice Smith"])).toBe("Alice Smith’s Pixel");
    expect(label("Alice Smith's Pixel", ["Alice Smith"])).toBe("Alice Smith’s Pixel");
    expect(label("James' phone", ["James"])).toBe("James’s phone");
  });

  test("leaves a name that starts with the owner but isn't possessive", () => {
    expect(label("Alice Pixel", ["Alice"])).toBe("Alice Pixel");
    expect(label("Alice", ["Alice"])).toBe("Alice");
    expect(label("Alice-phone", ["Alice"], true)).toBe("Alice-phone");
    expect(label("Alice's", ["Alice"])).toBe("Alice's");
  });

  test("treats My as the owner", () => {
    expect(label("My phone", ["Alice"])).toBe("Alice’s phone");
    expect(label("my phone", ["Alice"], true)).toBe("Your phone");
    expect(label("My phone", [])).toBe("Someone’s phone");
  });

  test("doesn't add an owner to a name that already has one", () => {
    expect(label("Ali's phone", ["Alice"])).toBe("Ali's phone");
    expect(label("Alice's Pixel", [])).toBe("Alice's Pixel");
  });

  test("only matches whole names", () => {
    expect(label("Samsung Galaxy", ["Sam"])).toBe("Sam’s Samsung Galaxy");
    expect(label("(Work) Pixel", ["(Work)"])).toBe("(Work) Pixel");
    expect(label("Sam's Pixel", ["Samuel"])).toBe("Sam's Pixel");
  });

  test("matches accented names however they were typed", () => {
    expect(label("José's phone", ["José"])).toBe("José’s phone");
  });
});
