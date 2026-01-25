import { describe, expect, it } from "bun:test";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("returns ok status", () => {
    const controller = new HealthController();
    expect(controller.getHealth()).toEqual({ status: "ok" });
  });
});
