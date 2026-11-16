import { Prisma } from "@openbeacon/database";
import { encryptGroupPayload, type EpochKeyMaterial } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND } from "@openbeacon/schemas";
import { parseClientPointId } from "./groupTracking.ts";

export const testClientPointId = (seed: string | number, revisionPrefix = "") => {
  const bytes = new Bun.CryptoHasher("sha256").update(String(seed)).digest().subarray(0, 8);
  return `${revisionPrefix}${Buffer.from(bytes).toString("base64")}`;
};

export const encryptedTrackingPoint = ({
  clientPointId,
  epochId,
  epochKey,
  groupId,
  payload = new Uint8Array(23),
  role = "POINT",
  senderDeviceId,
}: {
  clientPointId: string;
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  payload?: Record<string, unknown> | Uint8Array;
  role?: "POINT" | "STAY" | "LIVE";
  senderDeviceId: string;
}) => {
  const encrypted = encryptGroupPayload({
    epochId,
    epochKey,
    groupId,
    kind: TRACKING_POINT_KIND,
    payload,
    senderDeviceId,
  });
  return {
    ciphertext: encrypted.ciphertext,
    clientPointId,
    epochId,
    nonce: encrypted.nonce,
    role,
    senderDeviceId,
  };
};

export const storeTrackingStream = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  {
    epochId,
    groupId,
    revisionPrefix = "",
    senderDeviceId,
    senderUserId,
  }: {
    epochId: string;
    groupId: string;
    revisionPrefix?: string;
    senderDeviceId: string;
    senderUserId: string;
  },
) => {
  const [stream] = await db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
    INSERT INTO "TrackingStream" ("groupId", "epochId", "senderDeviceId", "senderUserId", "revisionPrefix")
    VALUES (${groupId}, ${epochId}, ${senderDeviceId}, ${senderUserId}, ${revisionPrefix})
    ON CONFLICT ("groupId", "epochId", "senderDeviceId", "revisionPrefix")
      DO UPDATE SET "senderUserId" = EXCLUDED."senderUserId"
    RETURNING id
  `);
  if (!stream) throw new Error("Tracking stream was not stored.");
  return stream.id;
};

export const storeTrackingPoints = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  {
    count = 1,
    receivedAt = new Date(),
    ...stream
  }: Parameters<typeof storeTrackingStream>[1] & { count?: number; receivedAt?: Date },
) => {
  const streamId = await storeTrackingStream(db, stream);
  await db.$queryRaw(Prisma.sql`
    INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedAt", "payload")
    SELECT ${streamId}, (random() * 9e18)::bigint, (${receivedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), '\\x00'::bytea
    FROM generate_series(1, ${count})
  `);
  return streamId;
};

export const storeLatestTrackingPoint = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  {
    payload = new Uint8Array(63),
    updatedAt = new Date(),
    ...stream
  }: Parameters<typeof storeTrackingStream>[1] & { payload?: Uint8Array; updatedAt?: Date },
) => {
  const streamId = await storeTrackingStream(db, stream);
  await db.$queryRaw(Prisma.sql`
    INSERT INTO "TrackingLatestPoint" ("groupId", "senderDeviceId", "streamId", "payload", "updatedAt")
    VALUES (${stream.groupId}, ${stream.senderDeviceId}, ${streamId}, decode(${Buffer.from(payload).toString("hex")}, 'hex'),
      (${updatedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("groupId", "senderDeviceId") DO UPDATE SET
      "streamId" = EXCLUDED."streamId", "payload" = EXCLUDED."payload", "updatedAt" = EXCLUDED."updatedAt"
  `);
  return streamId;
};

export const countTrackingPoints = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  where: Prisma.Sql,
) => {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "TrackingPoint" AS "point"
    JOIN "TrackingStream" AS "stream" ON "stream"."id" = "point"."streamId"
    WHERE ${where}
  `);
  return row?.count ?? 0;
};

export const storeUploadedTrackingPoint = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  {
    clientPointId,
    ...stream
  }: Omit<Parameters<typeof storeTrackingStream>[1], "revisionPrefix"> & { clientPointId: string },
) => {
  const { pointId, revisionPrefix } = parseClientPointId(clientPointId);
  const streamId = await storeTrackingStream(db, { ...stream, revisionPrefix });
  await db.$queryRaw(Prisma.sql`
    INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedAt", "payload")
    VALUES (${streamId}, ${pointId}, (now() AT TIME ZONE 'UTC'), '\\x00'::bytea)
  `);
};

export const trackingPointIds = async (
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  where: Prisma.Sql,
) =>
  (
    await db.$queryRaw<Array<{ pointId: string }>>(Prisma.sql`
      SELECT "point"."pointId"::text AS "pointId"
      FROM "TrackingPoint" AS "point"
      JOIN "TrackingStream" AS "stream" ON "stream"."id" = "point"."streamId"
      WHERE ${where}
      ORDER BY "point"."pointId"
    `)
  ).map(({ pointId }) => pointId);

export const pointIdOf = (clientPointId: string) =>
  parseClientPointId(clientPointId).pointId.toString();
