import { describe, expect, test } from "bun:test";
import { keyboardRevealOffset } from "./keyboardRevealOffset.ts";

describe("keyboardRevealOffset", () => {
  test("scrolls just far enough to lift the end of the form above the keyboard", () => {
    expect(keyboardRevealOffset({ focusedTop: 500, formBottom: 800, viewportHeight: 500 })).toBe(
      316,
    );
  });

  test("never scrolls the focused field out of view on short screens", () => {
    expect(keyboardRevealOffset({ focusedTop: 200, formBottom: 800, viewportHeight: 300 })).toBe(
      184,
    );
  });

  test("does not scroll when the form already fits above the keyboard", () => {
    expect(keyboardRevealOffset({ focusedTop: 100, formBottom: 400, viewportHeight: 500 })).toBe(0);
  });
});
