import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { cn } from "./cn.ts";

const require = createRequire(import.meta.url);

test("tailwind-merge is the major built for the installed Tailwind", () => {
  const tailwind: { version: string } = require("tailwindcss/package.json");
  const tailwindMerge: { version: string } = require("tailwind-merge/package.json");
  const mergeMajorForTailwind: Record<string, string> = { "3": "2", "4": "3" };

  expect(tailwindMerge.version.split(".")[0]).toBe(
    mergeMajorForTailwind[tailwind.version.split(".")[0] ?? ""],
  );
});

test("a later class replaces the earlier one it conflicts with", () => {
  expect(cn("text-base text-primary-text", "text-sm")).toBe("text-primary-text text-sm");
  expect(cn("text-foreground", "text-destructive-text")).toBe("text-destructive-text");
  expect(cn("bg-card px-4 py-3", "bg-primary p-2")).toBe("bg-primary p-2");
  expect(cn("rounded-2xl border border-warning-border", "rounded-full border-0")).toBe(
    "border-warning-border rounded-full border-0",
  );
  expect(cn("flex-1 gap-2", "flex-none gap-4")).toBe("flex-none gap-4");
  expect(cn("shadow", "shadow-none")).toBe("shadow-none");
  expect(cn("opacity-50", false, "opacity-100")).toBe("opacity-100");
});
