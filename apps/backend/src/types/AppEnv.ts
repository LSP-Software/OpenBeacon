import type { AuthType } from "@openbeacon/auth";
import type { OpenBeaconCache } from "@openbeacon/cache";
import type { DatabaseClient } from "./DatabaseClient.ts";

export type AppEnv = {
  Bindings: {
    cache: OpenBeaconCache;
    clientIp?: string;
    db: DatabaseClient;
  };
  Variables: AuthType;
};
