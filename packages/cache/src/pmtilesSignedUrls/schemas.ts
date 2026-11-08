import { z } from "zod";

export const pmtilesSignedUrlInputSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();

export const setPmtilesSignedUrlInputSchema = pmtilesSignedUrlInputSchema
  .extend({
    archiveKey: z.string().min(1),
    expiresAt: z.iso.datetime(),
    url: z.url(),
  })
  .strict();

export const pmtilesSignedUrlValueSchema = z
  .object({
    archiveKey: z.string().min(1),
    expiresAt: z.iso.datetime(),
    url: z.url(),
  })
  .strict();

export type PmtilesSignedUrlInput = z.infer<typeof pmtilesSignedUrlInputSchema>;
export type PmtilesSignedUrlValue = z.infer<typeof pmtilesSignedUrlValueSchema>;
export type SetPmtilesSignedUrlInput = z.infer<typeof setPmtilesSignedUrlInputSchema>;
