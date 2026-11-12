import { z } from "zod";

const slotStatusSchema = z
  .object({
    build: z.string(),
    publishedAt: z.string(),
    schemaVersion: z.string(),
    servedUntil: z.string().nullable(),
    size: z.number(),
  })
  .nullable();

export const updateRunSchema = z.object({
  running: z.boolean(),
  startedAt: z.string().nullable(),
  last: z
    .object({
      finishedAt: z.string(),
      outcome: z.enum(["published", "skipped", "failed"]),
      message: z.string(),
    })
    .nullable(),
});

export const mapStatusSchema = z.object({
  bucket: z.string(),
  current: z.enum(["a", "b"]).nullable(),
  slots: z.object({ a: slotStatusSchema, b: slotStatusSchema }),
  standbyReplaceableFrom: z.string().nullable(),
  nextUpdateDueAt: z.string().nullable(),
  untrackedArchives: z.array(z.object({ key: z.string(), size: z.number() })),
  resumableUploads: z.array(z.string()),
});

export const serviceStatusSchema = updateRunSchema.extend({
  map: mapStatusSchema,
});

export const updateResponseSchema = updateRunSchema.extend({
  alreadyRunning: z.boolean(),
});

export const rollbackResponseSchema = z.object({ message: z.string() });

export const errorResponseSchema = z.object({ error: z.string() });

export type MapStatus = z.infer<typeof mapStatusSchema>;
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type UpdateRun = z.infer<typeof updateRunSchema>;
