import { z } from "zod";

export const databaseUrlSchema = z
  .url()
  .refine(
    (value) =>
      URL.canParse(value) && ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    {
      message: "DATABASE_URL must use postgres:// or postgresql://",
    },
  );
