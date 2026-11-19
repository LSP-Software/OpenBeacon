import z from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Invalid email address" }).max(320));
export const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" })
  .max(128, { message: "Password must be at most 128 characters long" });
const refusedNameCharacters = /[\p{Cc}\p{Cs}]|(?![\u061C\u200C-\u200F])\p{Cf}/gu;
const blankLetters = /[\u115F\u1160\u2800\u3164\uFFA0]/gu;

export const isVisibleName = (name: string) =>
  !name.match(refusedNameCharacters) &&
  /[\p{L}\p{N}\p{P}\p{S}]/u.test(name.replace(blankLetters, ""));

export const sharedNameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `${label} is required` })
    .max(100, { message: `${label} must be at most 100 characters` })
    .refine(isVisibleName, {
      message: `${label} contains invalid characters`,
    });
export const accountNameSchema = sharedNameSchema("Name");
export const accountNameFromProfile = (name: string) => {
  const cleaned = name.replace(refusedNameCharacters, "").trim().slice(0, 100);
  const result = accountNameSchema.safeParse(cleaned.replace(/[\uD800-\uDBFF]$/, ""));
  return result.success ? result.data : "OpenBeacon user";
};
