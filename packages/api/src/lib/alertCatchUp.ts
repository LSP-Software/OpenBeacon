import { type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import { decodeAlertsCursor, encodeAlertsCursor } from "./placeTransitions.ts";

const CATCH_UP_OVERLAP_MS = 60_000;
const CATCH_UP_LIMIT = 100;

export const readAlertCatchUp = async <Row extends { receivedAt: Date }>({
  cursor,
  db,
  lookbackMs,
  read,
}: {
  cursor: string | null;
  db: PrismaClient;
  lookbackMs: number;
  read: (window: { now: Date; since: Date; limit: number }) => Promise<Row[]>;
}) => {
  const now = await readDatabaseTime(db);
  const caughtUp = encodeAlertsCursor({ createdAt: now, id: "" });
  if (cursor === null) return { rows: [] as Row[], cursor: caughtUp };
  const since = new Date(
    Math.max(
      decodeAlertsCursor(cursor).createdAt.getTime() - CATCH_UP_OVERLAP_MS,
      now.getTime() - lookbackMs,
    ),
  );
  const rows = await read({ now, since, limit: CATCH_UP_LIMIT });
  const last = rows.at(-1);
  return {
    rows,
    cursor:
      last && rows.length === CATCH_UP_LIMIT
        ? encodeAlertsCursor({
            createdAt: new Date(last.receivedAt.getTime() + CATCH_UP_OVERLAP_MS),
            id: "",
          })
        : caughtUp,
  };
};
