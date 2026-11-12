import { tryCatch } from "@openbeacon/shared";
import {
  errorResponseSchema,
  type MapStatus,
  rollbackResponseSchema,
  type ServiceStatus,
  serviceStatusSchema,
  updateResponseSchema,
} from "./status.ts";
import { formatBytes } from "./transfer.ts";

export const createMapTilesClient = ({
  fetch = globalThis.fetch,
  serviceUrl,
}: {
  fetch?: typeof globalThis.fetch;
  serviceUrl: string;
}) => {
  const call = async (path: string, init: { method: "GET" | "POST"; body?: unknown }) => {
    const response = await tryCatch(
      fetch(new URL(path, serviceUrl), {
        method: init.method,
        headers: { "content-type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(30_000),
      }),
    );

    if (response.error) {
      throw new Error(
        `Could not reach the map tiles service at ${serviceUrl}: ${response.error.message}`,
      );
    }

    const body = await tryCatch(response.data.json() as Promise<unknown>);

    if (!response.data.ok) {
      const error = errorResponseSchema.safeParse(body.data);
      throw new Error(
        error.success ? error.data.error : `The service answered ${response.data.status}`,
      );
    }

    return body.data;
  };

  return {
    rollback: async () =>
      rollbackResponseSchema.parse(await call("/rollback", { method: "POST" })).message,
    status: async () => serviceStatusSchema.parse(await call("/status", { method: "GET" })),
    update: async () =>
      updateResponseSchema.parse(await call("/update", { method: "POST", body: { force: true } })),
  };
};

const formatBuild = (build: string) =>
  `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6, 8)}`;

const describeSlot = ({ map, now, slot }: { map: MapStatus; now: number; slot: "a" | "b" }) => {
  const archive = map.slots[slot];
  const name = `Slot ${slot.toUpperCase()}`;

  if (!archive) {
    return `${name}: empty`;
  }

  const description = `${name}: Protomaps build ${formatBuild(archive.build)} (schema ${archive.schemaVersion}, ${formatBytes(archive.size)}, published ${archive.publishedAt})`;

  if (map.current === slot) {
    return `${description}, in use`;
  }

  return archive.servedUntil && now < Date.parse(archive.servedUntil)
    ? `${description}, still served to open maps until ${archive.servedUntil}`
    : `${description}, kept for rollback`;
};

export const formatStatus = ({ now, status }: { now: number; status: ServiceStatus }) => {
  const { map } = status;
  const lines = [`Bucket: ${map.bucket}`];

  lines.push(
    map.current
      ? `Map in use: slot ${map.current.toUpperCase()}`
      : "Map in use: none yet; the next update downloads the map into slot A",
  );
  lines.push(describeSlot({ map, now, slot: "a" }), describeSlot({ map, now, slot: "b" }));

  if (map.standbyReplaceableFrom === "never") {
    lines.push("The standby slot has no end date, so updates will not replace it");
  } else if (map.standbyReplaceableFrom) {
    lines.push(`The standby slot can be replaced from ${map.standbyReplaceableFrom}`);
  }

  if (map.nextUpdateDueAt) {
    lines.push(
      `Next scheduled update: from ${map.nextUpdateDueAt}, if Protomaps has a newer build`,
    );
  }

  lines.push(
    map.speedLimitMbps === null
      ? "Speed limit: none (set MAP_TILES_MAX_MBPS to cap it)"
      : `Speed limit: ${map.speedLimitMbps} Mbps each way (MAP_TILES_MAX_MBPS)`,
  );

  lines.push(status.running ? `Update: running since ${status.startedAt}` : "Update: not running");

  if (status.last) {
    lines.push(
      `Last update: ${status.last.outcome} at ${status.last.finishedAt}: ${status.last.message}`,
    );
  }

  for (const archive of map.untrackedArchives) {
    lines.push(
      `Untracked archive: ${archive.key} (${formatBytes(archive.size)}); not managed by the map tiles service`,
    );
  }

  for (const upload of map.resumableUploads) {
    lines.push(`Resumable upload: ${upload}`);
  }

  return lines.join("\n");
};
