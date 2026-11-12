import { z } from "zod";

const statusSchema = z.object({
  alreadyRunning: z.boolean(),
  last: z
    .object({
      finishedAt: z.string(),
      outcome: z.enum(["published", "skipped", "failed"]),
      message: z.string(),
    })
    .nullable(),
});

export const createMapTilesUpdate = ({
  apiKey,
  fetch = globalThis.fetch,
  url,
}: {
  apiKey: string | undefined;
  fetch?: typeof globalThis.fetch;
  url: string | undefined;
}) => {
  if (!apiKey || !url) {
    return null;
  }

  return async () => {
    const response = await fetch(new URL("/update", url), {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status !== 202) {
      throw Object.assign(new Error("The map tiles service refused the update"), {
        code: `MAP_TILES_HTTP_${response.status}`,
      });
    }

    const status = statusSchema.parse(await response.json());

    if (status.alreadyRunning) {
      console.log("Map update still running");
    }
    if (status.last?.outcome === "failed") {
      throw Object.assign(new Error("The previous map update failed"), {
        code: "MAP_TILES_UPDATE_FAILED",
      });
    }
  };
};
