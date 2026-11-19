import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient, readDatabaseTime } from "@openbeacon/database";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";

export const createGoogleSignInChallenges = ({
  db,
  secret,
  lifetimeMs = 5 * 60 * 1000,
}: {
  db: PrismaClient;
  secret: string;
  lifetimeMs?: number;
}) => {
  const sign = (body: string) =>
    createHmac("sha256", secret)
      .update(`openbeacon-google-sign-in-challenge\n${body}`)
      .digest("base64url");

  const expiryOf = (challenge: string) => {
    const match = /^(\d{1,15})\.([\w-]{43})\.([\w-]{43})$/.exec(challenge);
    if (!match?.[1] || !match[2] || !match[3]) return null;
    const expected = Buffer.from(sign(`${match[1]}.${match[2]}`));
    const given = Buffer.from(match[3]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return new Date(Number(match[1]));
  };

  return {
    issue: async () => {
      const expiresAt = (await readDatabaseTime(db)).getTime() + lifetimeMs;
      const body = `${expiresAt.toString()}.${randomBytes(32).toString("base64url")}`;
      return `${body}.${sign(body)}`;
    },
    isGenuine: (challenge: string) => expiryOf(challenge) !== null,
    use: async (challenge: string) => {
      const expiresAt = expiryOf(challenge);
      if (!expiresAt) return false;
      const id = `google-sign-in-challenge:${createHash("sha256").update(challenge).digest("hex")}`;
      const inserted = await db.$executeRaw(
        Prisma.sql`INSERT INTO "Verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
          SELECT ${id}, 'google-sign-in-challenge', '', ${expiresAt.toISOString()}::timestamptz AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC'
          WHERE ${expiresAt.toISOString()}::timestamptz > clock_timestamp()
          ON CONFLICT (id) DO NOTHING`,
      );
      return inserted === 1;
    },
  };
};

export const googleSignInChallengePlugin = (
  challenges: ReturnType<typeof createGoogleSignInChallenges> | null,
) =>
  ({
    id: "google-sign-in-challenge",
    endpoints: {
      googleSignInChallenge: createAuthEndpoint(
        "/google-sign-in/challenge",
        { method: "POST" },
        async (ctx) => {
          if (!challenges) throw new APIError("NOT_FOUND");
          return ctx.json({ challenge: await challenges.issue() });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
