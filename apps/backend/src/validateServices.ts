import { checkR2, checkS3 } from "@openbeacon/api/checkStorage.ts";
import { RedisClient } from "bun";
import { checkServices } from "./checkServices.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";

await checkServices({
  PostgreSQL: () => db.$queryRaw`SELECT 1`,
  Redis: async () => {
    const redis = new RedisClient(env.REDIS_URL);
    try {
      await redis.send("PING", []);
    } finally {
      redis.close();
    }
  },
  S3: checkS3,
  R2: checkR2,
});
