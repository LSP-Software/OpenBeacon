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
const refusedNameCharacters = /[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069]/gu;
const visibleCharacter = /[\p{L}\p{N}\p{P}\p{S}]/u;

export const sharedNameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `${label} is required` })
    .max(100, { message: `${label} must be at most 100 characters` })
    .refine((name) => !name.match(refusedNameCharacters) && visibleCharacter.test(name), {
      message: `${label} contains invalid characters`,
    });
export const accountNameSchema = sharedNameSchema("Name");
export const accountNameFromProfile = (name: string) => {
  const cleaned = name.replace(refusedNameCharacters, "").trim().slice(0, 100);
  const result = accountNameSchema.safeParse(cleaned.replace(/[\uD800-\uDBFF]$/, ""));
  return result.success ? result.data : "OpenBeacon user";
};
export const isVisibleName = (name: string) =>
  !/[\p{Cc}\p{Cs}]|(?!\u200D)\p{Cf}/u.test(name) && /[\p{L}\p{N}\p{P}\p{S}]/u.test(name);
