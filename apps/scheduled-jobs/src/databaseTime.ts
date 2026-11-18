import { readDatabaseTime } from "@openbeacon/database";
import { services } from "./services.ts";

export const getDatabaseTime = () => readDatabaseTime(services.db);
