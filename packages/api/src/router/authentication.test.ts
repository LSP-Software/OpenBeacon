import { describe, expect, test } from "bun:test";
import { appRouter } from "../root.ts";

describe("API authentication", () => {
  test("rejects anonymous access to every non-public procedure", async () => {
    const caller = appRouter.createCaller({ session: null } as Parameters<
      typeof appRouter.createCaller
    >[0]);
    const publicProcedures = new Set(["auth.providers", "feedback.submit"]);
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toContain("auth.providers");
    for (const path of procedures.filter((name) => !publicProcedures.has(name))) {
      const [router, procedure] = path.split(".");
      const routes = caller as unknown as Record<
        string,
        Record<string, (input?: unknown) => Promise<unknown>>
      >;
      await expect(routes[router!]![procedure!]()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });
});
