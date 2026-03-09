import * as p from "@openbeacon/database";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../env";

export const createDbClient = () => {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new p.PrismaClient({ adapter });
};

export const db = createDbClient();
