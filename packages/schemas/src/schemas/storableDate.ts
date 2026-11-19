import z from "zod";

export const storableDateSchema = z
  .date()
  .min(new Date("1970-01-01T00:00:00.000Z"))
  .max(new Date("9999-12-31T23:59:59.999Z"));
