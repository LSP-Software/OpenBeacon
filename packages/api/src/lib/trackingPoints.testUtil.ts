import { Prisma } from "@openbeacon/database";
import { encryptGroupPayload, type EpochKeyMaterial } from "@openbeacon/encryption";
import { TRACKING_POINT_KIND, type TRACKING_POINT_ROLES } from "@openbeacon/schemas";
import { parseClientPointId } from "./groupTracking.ts";

export const testClientPointId = (seed: string | number, revisionPrefix = "") => {
  const bytes = new Bun.CryptoHasher("sha256").update(String(seed)).digest().subarray(0, 8);
  return `${revisionPrefix}${Buffer.from(bytes).toString("base64")}`;
};

export const encryptedTrackingPoint = ({
  capturedHour,
  clientPointId,
  epochId,
  epochKey,
  groupId,
  payload = new Uint8Array(23),
  role = "POINT",
  senderDeviceId,
}: {
  capturedHour?: number;
  clientPointId: string;
  epochId: string;
  epochKey: EpochKeyMaterial;
  groupId: string;
  payload?: Uint8Array;
  role?: (typeof TRACKING_POINT_ROLES)[number];
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
    ...(capturedHour === undefined ? {} : { capturedHour }),
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
    receivedHour = Math.floor(Date.now() / 3_600_000),
    capturedHour = receivedHour,
    ...stream
  }: Parameters<typeof storeTrackingStream>[1] & {
    capturedHour?: number;
    count?: number;
    receivedHour?: number;
  },
) => {
  const streamId = await storeTrackingStream(db, stream);
  await db.$queryRaw(Prisma.sql`
    INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
    SELECT ${streamId}, (random() * 9e18)::bigint, ${receivedHour}, ${capturedHour}, '\\x00'::bytea
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
    INSERT INTO "TrackingPoint" ("streamId", "pointId", "receivedHour", "capturedHour", "payload")
    VALUES (${streamId}, ${pointId}, floor(extract(epoch FROM now()) / 3600)::int4,
      floor(extract(epoch FROM now()) / 3600)::int4, '\\x00'::bytea)
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
