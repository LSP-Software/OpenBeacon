import z from "zod";

export const sealedPersonalDataSchema = z.string().min(1).max(2048);
