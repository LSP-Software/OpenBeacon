import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

export const runVerificationCleanup = async () => {
  await services.db.verification.deleteMany({
    where: { expiresAt: { lt: await getDatabaseTime() } },
  });
};
