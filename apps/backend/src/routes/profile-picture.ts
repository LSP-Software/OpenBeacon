import { Hono } from "hono";
import { z } from "zod";
import { env } from "../env.ts";
import { fileExists, getUploadUrl } from "../helpers/b2.ts";
import type { AuthType } from "../helpers/betterAuth.ts";
import { db } from "../helpers/db.ts";
import { redis } from "../helpers/redis.ts";
import { requireAuth } from "../middleware/auth.ts";

const UUID_WEBP_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;

const requestUploadSchema = z.object({
  sha1: z.string(),
  fileSize: z.number().int().positive(),
});

const confirmUploadSchema = z.object({
  fileName: z.string().regex(UUID_WEBP_PATTERN),
});

const router = new Hono<{ Variables: AuthType }>();

router.use(requireAuth);

router.post("/profile-picture/request-upload", async (c) => {
  const body = requestUploadSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ message: "Invalid request body" }, 400);
  }

  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const rateLimitKey = `rate:pfp:${user.id}`;
  const now = Date.now();

  await redis.zremrangebyscore(rateLimitKey, 0, now - RATE_LIMIT_WINDOW_MS);
  const recentCount = await redis.zcard(rateLimitKey);

  if (recentCount >= RATE_LIMIT_MAX) {
    return c.json({ message: "Too many uploads. Please wait a moment before trying again." }, 429);
  }

  await redis.zadd(rateLimitKey, now, `${now}`);
  await redis.expire(rateLimitKey, 60);

  const fileName = `${crypto.randomUUID()}.webp`;

  let uploadData: Awaited<ReturnType<typeof getUploadUrl>>;
  try {
    uploadData = await getUploadUrl();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare upload. Please try again.";
    return c.json({ message }, 502);
  }

  return c.json({
    uploadUrl: uploadData.uploadUrl,
    authToken: uploadData.authorizationToken,
    fileName,
  });
});

router.post("/profile-picture/confirm-upload", async (c) => {

  console.log("Confirming upload");

  const body = confirmUploadSchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ message: "Invalid request body" }, 400);
  }

  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  console.log("User:", user);

  const { fileName } = body.data;

  let exists: boolean;
  try {
    exists = await fileExists(fileName);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to verify upload. Please try again.";
    return c.json({ message }, 502);
  }

  console.log("Exists:", exists);

  if (!exists) {
    return c.json({ message: "Upload could not be verified. Please try again." }, 404);
  }

  const version = Date.now();
  const imageUrl = `${env.B2_PUBLIC_URL}/${fileName}?v=${version}`;

  console.log("Image URL:", imageUrl);

  await db.user.update({
    where: { id: user.id },
    data: { image: imageUrl },
  });

  return c.json({ imageUrl });
});

export default router;
