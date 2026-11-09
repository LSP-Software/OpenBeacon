import { describe, expect, test } from "bun:test";
import { fillRecoveryWords } from "./fillRecoveryWords.ts";

const empty = ["", "", "", ""];

describe("fillRecoveryWords", () => {
  test("keeps a partly typed word in its box and focus there", () => {
    expect(fillRecoveryWords(empty, 1, "ab")).toEqual({
      words: ["", "ab", "", ""],
      focusIndex: 1,
    });
  });

  test("a trailing space ends the word without keeping the space and moves on", () => {
    expect(fillRecoveryWords(empty, 0, "apple ")).toEqual({
      words: ["apple", "", "", ""],
      focusIndex: 1,
    });
  });

  test("a trailing newline moves on like a space", () => {
    expect(fillRecoveryWords(empty, 0, "apple\n").focusIndex).toBe(1);
  });

  test("spills several words into the following boxes without touching earlier ones", () => {
    expect(fillRecoveryWords(["one", "", "", "old"], 1, "two three")).toEqual({
      words: ["one", "two", "three", "old"],
      focusIndex: 2,
    });
  });

  test("overwrites later boxes and moves past the last pasted word after trailing whitespace", () => {
    expect(fillRecoveryWords(["a", "b", "c", "d"], 0, "x y ")).toEqual({
      words: ["x", "y", "c", "d"],
      focusIndex: 2,
    });
  });

  test("ignores words that do not fit and stays on the last box", () => {
    expect(fillRecoveryWords(empty, 2, "a b c d ")).toEqual({
      words: ["", "", "a", "b"],
      focusIndex: 3,
    });
  });

  test("normalises case and runs of whitespace", () => {
    expect(fillRecoveryWords(empty, 0, "  Apple \t\n  BANANA").words).toEqual([
      "apple",
      "banana",
      "",
      "",
    ]);
  });

  test("clears the box when only whitespace remains", () => {
    expect(fillRecoveryWords(["apple", "", "", ""], 0, "  ")).toEqual({
      words: ["", "", "", ""],
      focusIndex: 0,
    });
  });

  test("does not mutate the original words", () => {
    const words = ["", ""];
    fillRecoveryWords(words, 0, "a b");
    expect(words).toEqual(["", ""]);
  });
});
