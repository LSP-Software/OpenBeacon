import { expect, test } from "bun:test";
import { initials } from "./initials.ts";

test("initials are upper-cased and never split an emoji", () => {
  expect(initials("dad")).toBe("DA");
  expect(initials("😀x")).toBe("😀X");
});
