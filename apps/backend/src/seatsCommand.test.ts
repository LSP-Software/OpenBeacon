import { describe, expect, test } from "bun:test";
import { parseSeatsCommand } from "./seatsCommand.ts";

describe("parseSeatsCommand", () => {
  test("shows and sets an account's seats", () => {
    expect(parseSeatsCommand(["show", "sam@example.test"])).toEqual({
      command: "show",
      email: "sam@example.test",
    });
    expect(parseSeatsCommand(["set", "sam@example.test", "0"])).toEqual({
      command: "set",
      email: "sam@example.test",
      seats: 0,
    });
    expect(parseSeatsCommand(["set", "sam@example.test", "1024"])).toEqual({
      command: "set",
      email: "sam@example.test",
      seats: 1024,
    });
  });

  test("only takes a whole number of seats up to 16 groups of 64", () => {
    for (const seats of ["1025", "-1", "2.5", "two", "", "1e3"]) {
      expect(parseSeatsCommand(["set", "sam@example.test", seats])).toMatchObject({
        command: "error",
      });
    }
  });

  test("shows help with no arguments and refuses anything else", () => {
    expect(parseSeatsCommand([])).toEqual({ command: "help" });
    expect(parseSeatsCommand(["help"])).toEqual({ command: "help" });
    for (const args of [
      ["set", "sam@example.test"],
      ["set", "sam@example.test", "2", "3"],
      ["show"],
      ["show", "sam@example.test", "2"],
      ["remove", "sam@example.test"],
      ["end-period", "sam@example.test"],
      ["renew", "sam@example.test"],
    ]) {
      expect(parseSeatsCommand(args)).toMatchObject({ command: "error" });
    }
  });
});
