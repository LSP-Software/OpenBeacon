import { checkMapStorage, checkImageStorage } from "@openbeacon/api/checkStorage.ts";
import { checkEmail, emailEnabled } from "@openbeacon/email";
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
  "Image storage": checkImageStorage,
  "Map storage": checkMapStorage,
  ...(emailEnabled ? { Email: checkEmail } : {}),
});
