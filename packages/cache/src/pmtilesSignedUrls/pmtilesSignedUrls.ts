import type { RedisLike } from "../cache/redis.ts";
import {
  pmtilesSignedUrlInputSchema,
  pmtilesSignedUrlValueSchema,
  setPmtilesSignedUrlInputSchema,
} from "./schemas.ts";

const buildPmtilesSignedUrlKey = ({ keyPrefix, userId }: { keyPrefix: string; userId: string }) => {
  return `${keyPrefix}:pmtilesSignedUrl:user:${userId}`;
};

export const createPmtilesSignedUrls = ({
  keyPrefix,
  now,
  redis,
}: {
  keyPrefix: string;
  now: () => number;
  redis: RedisLike;
}) => {
  return {
    get: async (input: Parameters<typeof pmtilesSignedUrlInputSchema.parse>[0]) => {
      const parsedInput = pmtilesSignedUrlInputSchema.parse(input);
      const key = buildPmtilesSignedUrlKey({
        keyPrefix,
        userId: parsedInput.userId,
      });
      const result = await redis.send("GET", [key]);

      if (typeof result !== "string") {
        return null;
      }

      let json: unknown;

      try {
        json = JSON.parse(result);
      } catch {
        await redis.del(key);
        return null;
      }

      const parsedValue = pmtilesSignedUrlValueSchema.safeParse(json);

      if (!parsedValue.success) {
        await redis.del(key);
        return null;
      }

      return parsedValue.data;
    },
    set: async (input: Parameters<typeof setPmtilesSignedUrlInputSchema.parse>[0]) => {
      const parsedInput = setPmtilesSignedUrlInputSchema.parse(input);
      const ttlMs = Math.max(new Date(parsedInput.expiresAt).getTime() - now(), 1);

      await redis.send("SET", [
        buildPmtilesSignedUrlKey({
          keyPrefix,
          userId: parsedInput.userId,
        }),
        JSON.stringify({
          expiresAt: parsedInput.expiresAt,
          url: parsedInput.url,
        }),
        "PX",
        String(ttlMs),
      ]);
    },
    reset: async (input: Parameters<typeof pmtilesSignedUrlInputSchema.parse>[0]) => {
      const parsedInput = pmtilesSignedUrlInputSchema.parse(input);

      return redis.del(
        buildPmtilesSignedUrlKey({
          keyPrefix,
          userId: parsedInput.userId,
        }),
      );
    },
  };
};
