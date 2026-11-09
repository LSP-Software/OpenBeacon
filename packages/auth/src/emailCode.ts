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
} from "@openbeacon/email";

export const emailCodeLifetimeMs = 10 * 60 * 1000;
export const emailCodeMaxAttempts = 5;
export const signUpTokenLifetimeMs = 30 * 60 * 1000;
export const emailCodeRequestLimits = {
  perAddress: { limit: 3, windowMs: 15 * 60 * 1000 },
  perIp: { limit: 20, windowMs: 60 * 60 * 1000 },
};

type CodeTarget = { purpose: EmailCodePurpose; subject: string };
type SignUpToken = { token: string; email: string };

export const createEmailCodes = ({
  db,
  secret,
  rateLimits,
  sendCodeEmail,
  sendAccountExistsEmail,
  now = () => new Date(),
}: {
  db: PrismaClient;
  secret: string;
  rateLimits: Pick<OpenBeaconCache["rateLimits"], "consume">;
  sendCodeEmail: (email: Parameters<typeof sendCode>[0]) => Promise<unknown>;
  sendAccountExistsEmail: (email: Parameters<typeof sendAccountExists>[0]) => Promise<unknown>;
  now?: () => Date;
}) => {
  const identifierFor = ({ purpose, subject }: CodeTarget) =>
    `email-code:${purpose}:${purpose === "recovery-reset" ? subject : normalizeEmail(subject)}`;

  const hash = (identifier: string, code: string) =>
    createHmac("sha256", secret).update(`${identifier}:${code}`).digest();

  const signUpTokenWhere = ({ token, email }: SignUpToken) => ({
    identifier: signUpTokenIdentifier(token),
    value: normalizeEmail(email),
    expiresAt: { gt: now() },
  });

  return {
    allowRequest: async ({ email, ip }: { email: string; ip: string | null }) => {
      const ipResult = await rateLimits.consume({
        namespace: "emailCode.request",
        identifier: { type: "ip", value: ip ?? "unknown" },
        ...emailCodeRequestLimits.perIp,
      });
      if (!ipResult.allowed) return false;
      const addressResult = await rateLimits.consume({
        namespace: "emailCode.request",
        identifier: {
          type: "email",
          value: createHash("sha256").update(normalizeEmail(email)).digest("hex"),
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

    check: async ({
      purpose,
      subject,
      code,
      tx = db,
    }: CodeTarget & { code: string; tx?: Prisma.TransactionClient }): Promise<
      { valid: true } | { valid: false; reason: "invalid" | "expired" | "locked" }
    > => {
      const identifier = identifierFor({ purpose, subject });
      const row = await db.verification.findFirst({
        where: { identifier },
        orderBy: { createdAt: "desc" },
      });
      if (!row || !/^\d{6}$/.test(code)) return { valid: false, reason: "invalid" };
      if (row.expiresAt <= now()) {
        await db.verification.deleteMany({ where: { id: row.id } });
        return { valid: false, reason: "expired" };
      }
      const attempt = await db.verification.updateMany({
        where: { id: row.id, attempts: { lt: emailCodeMaxAttempts } },
        data: { attempts: { increment: 1 } },
      });
      if (attempt.count === 0) return { valid: false, reason: "locked" };
      if (!timingSafeEqual(Buffer.from(row.value, "hex"), hash(identifier, code))) {
        return { valid: false, reason: "invalid" };
      }
      const consumed = await tx.verification.deleteMany({
        where: { id: row.id },
      });
      return consumed.count === 1 ? { valid: true } : { valid: false, reason: "invalid" };
    },

    issueSignUpToken: async (email: string) => {
      const token = randomBytes(32).toString("base64url");
      await db.verification.create({
        data: {
          id: randomUUID(),
          identifier: signUpTokenIdentifier(token),
          value: normalizeEmail(email),
          expiresAt: new Date(now().getTime() + signUpTokenLifetimeMs),
        },
      });
      return token;
    },

    hasSignUpToken: async (signUpToken: SignUpToken) =>
      (await db.verification.count({ where: signUpTokenWhere(signUpToken) })) === 1,

    consumeSignUpToken: async (signUpToken: SignUpToken) =>
      (await db.verification.deleteMany({ where: signUpTokenWhere(signUpToken) })).count === 1,
  };
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const signUpTokenIdentifier = (token: string) =>
  `sign-up-token:${createHash("sha256").update(token).digest("hex")}`;

export type EmailCodes = ReturnType<typeof createEmailCodes>;
