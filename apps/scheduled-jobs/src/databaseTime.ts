import { services } from "./services.ts";

export const getDatabaseTime = async () => {
  const [clock] = await services.db.$queryRaw<
    Array<{ now: Date }>
  >`SELECT clock_timestamp() AS now`;
  if (!clock) throw new Error("Unable to read database time.");
  return clock.now;
};
