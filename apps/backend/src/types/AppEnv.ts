import type { AuthType } from "@openbeacon/auth";
import type { OpenBeaconCache } from "@openbeacon/cache";
import type { DatabaseClient } from "../db.ts";

export type AppEnv = {
  Bindings: {
    cache: OpenBeaconCache;
    clientIp: string | null;
    db: DatabaseClient;
  };
  Variables: AuthType;
};
