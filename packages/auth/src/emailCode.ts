import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { OpenBeaconCache } from "@openbeacon/cache";
import { Prisma, type PrismaClient } from "@openbeacon/database";
import type {
  EmailCodePurpose,
  sendAccountExistsEmail as sendAccountExists,
  sendCodeEmail as sendCode,
  sendGoogleSignInEmail as sendGoogleSignIn,
} from "@openbeacon/email";
import { tryCatch } from "@openbeacon/shared";

export const emailCodeLifetimeMs = 10 * 60 * 1000;
export const emailCodeMaxAttempts = 5;
export const emailCodeTokens = {
  "sign-up": { prefix: "sign-up-token", lifetimeMs: 30 * 60 * 1000 },
  // better-auth's /reset-password spends this token, looking it up by its own prefix.
  "password-reset": { prefix: "reset-password", lifetimeMs: 5 * 60 * 1000 },
  "recovery-reset": { prefix: "recovery-reset-token", lifetimeMs: 15 * 60 * 1000 },
} satisfies Record<
  Exclude<EmailCodePurpose, "email-verification">,
  { prefix: string; lifetimeMs: number }
>;
export const emailCodeRequestLimits = {
  perAddress: { limit: 3, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 20, windowMs: 60 * 60 * 1000 },
};
export const emailCodeWrongGuessLimit = { limit: 10, windowMs: 24 * 60 * 60 * 1000 };

type CodeTarget = { purpose: EmailCodePurpose; subject: string };
type TokenTarget = {
  purpose: keyof typeof emailCodeTokens;
  token: string;
  value: string;
};

export const createEmailCodes = ({
  db,
  secret,
  rateLimits,
  limitRequestsPerIp,
  sendCodeEmail,
  sendAccountExistsEmail,
  sendGoogleSignInEmail,
  now = () => new Date(),
}: {
  db: PrismaClient;
  secret: string;
  rateLimits: Pick<OpenBeaconCache["rateLimits"], "consume" | "peek">;
  limitRequestsPerIp: boolean;
  sendCodeEmail: (email: Parameters<typeof sendCode>[0]) => Promise<unknown>;
  sendAccountExistsEmail: (email: Parameters<typeof sendAccountExists>[0]) => Promise<unknown>;
  sendGoogleSignInEmail: (email: Parameters<typeof sendGoogleSignIn>[0]) => Promise<unknown>;
  now?: () => Date;
}) => {
  const identifierFor = ({ purpose, subject }: CodeTarget) =>
    `email-code:${purpose}:${purpose === "recovery-reset" ? subject : normalizeEmail(subject)}`;

  const hash = (identifier: string, code: string) =>
    createHmac("sha256", secret).update(`${identifier}:${code}`).digest();

  const tokenWhere = ({ purpose, token, value }: TokenTarget) => ({
    identifier: tokenIdentifier(purpose, token),
    value,
    expiresAt: { gt: now() },
  });

  return {
    allowRequest: async ({
      purpose,
      email,
      ip,
    }: {
      purpose: EmailCodePurpose;
      email: string;
      ip: string | null;
    }) => {
      if (limitRequestsPerIp) {
        const ipResult = await rateLimits.consume({
          namespace: "emailCode.request",
          identifier: { type: "ip", value: ip ?? "unknown" },
          ...emailCodeRequestLimits.perIp,
        });
        if (!ipResult.allowed) return false;
      }
      const addressResult = await rateLimits.consume({
        namespace: `emailCode.request.${purpose}`,
        identifier: {
          type: "email",
          value: normalizeEmail(email),
        },
        ...emailCodeRequestLimits.perAddress,
      });
      return addressResult.allowed;
    },

    send: async ({
      purpose,
      subject,
      to,
      userId,
    }: CodeTarget & { to: string; userId?: string }) => {
      const identifier = identifierFor({ purpose, subject });
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      await db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`);
        await tx.verification.deleteMany({ where: { identifier } });
        await tx.verification.create({
          data: {
            id: randomUUID(),
            identifier,
            value: hash(identifier, code).toString("hex"),
            expiresAt: new Date(now().getTime() + emailCodeLifetimeMs),
          },
        });
      });
      await sendCodeEmail({ to, purpose, code, ...(userId ? { userId } : {}) });
    },

    sendAccountExists: sendAccountExistsEmail,

    sendGoogleSignIn: sendGoogleSignInEmail,

    check: async ({
      purpose,
      subject,
      code,
    }: CodeTarget & { code: string }): Promise<
      { valid: true } | { valid: false; reason: "invalid" | "expired" | "locked" }
    > => {
      const identifier = identifierFor({ purpose, subject });
      if (!/^\d{6}$/.test(code)) return { valid: false, reason: "invalid" };
      const existing = await db.verification.findFirst({
        where: { identifier },
        select: { id: true },
      });
      if (!existing) return { valid: false, reason: "invalid" };
      const wrongGuessLimit = {
        namespace: `emailCode.check.${purpose}`,
        identifier:
          purpose === "recovery-reset"
            ? { type: "userId" as const, value: subject }
            : { type: "email" as const, value: normalizeEmail(subject) },
        ...emailCodeWrongGuessLimit,
      };
      return db.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${identifier})) AS acquired`,
        );
        if (!lock?.acquired) return { valid: false, reason: "invalid" };
        const row = await tx.verification.findFirst({
          where: { identifier },
          orderBy: { createdAt: "desc" },
        });
        if (!row) return { valid: false, reason: "invalid" };
        if (row.expiresAt <= now()) {
          await tx.verification.deleteMany({ where: { id: row.id } });
          return { valid: false, reason: "expired" };
        }
        const allowance = await tryCatch(rateLimits.peek(wrongGuessLimit));
        if (allowance.error) {
          console.error(`[email-code] could not read the ${purpose} wrong guess allowance`);
          return { valid: false, reason: "invalid" };
        }
        if (allowance.data.remaining < 1) return { valid: false, reason: "locked" };
        const attempt = await tx.verification.updateMany({
          where: { id: row.id, attempts: { lt: emailCodeMaxAttempts } },
          data: { attempts: { increment: 1 } },
        });
        if (attempt.count === 0) return { valid: false, reason: "locked" };
        if (!timingSafeEqual(Buffer.from(row.value, "hex"), hash(identifier, code))) {
          const spent = await tryCatch(rateLimits.consume(wrongGuessLimit));
          if (spent.error) {
            console.error(`[email-code] could not record a ${purpose} wrong guess`);
          }
          return { valid: false, reason: "invalid" };
        }
        const consumed = await tx.verification.deleteMany({ where: { id: row.id } });
        return consumed.count === 1 ? { valid: true } : { valid: false, reason: "invalid" };
      });
    },

    issueToken: async ({ purpose, value }: Omit<TokenTarget, "token">) => {
      const token = randomBytes(32).toString("base64url");
      await db.verification.create({
        data: {
          id: randomUUID(),
          identifier: tokenIdentifier(purpose, token),
          value,
          expiresAt: new Date(now().getTime() + emailCodeTokens[purpose].lifetimeMs),
        },
      });
      return token;
    },

    hasToken: async (target: TokenTarget) =>
      (await db.verification.count({ where: tokenWhere(target) })) === 1,

    consumeToken: async ({ tx = db, ...target }: TokenTarget & { tx?: Prisma.TransactionClient }) =>
      (await tx.verification.deleteMany({ where: tokenWhere(target) })).count === 1,
  };
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const tokenIdentifier = (purpose: TokenTarget["purpose"], token: string) =>
  createHash("sha256").update(`${emailCodeTokens[purpose].prefix}:${token}`).digest("base64url");

export type EmailCodes = ReturnType<typeof createEmailCodes>;
