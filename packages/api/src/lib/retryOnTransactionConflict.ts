import { Prisma } from "@openbeacon/database";
import { errorCode, tryCatch } from "@openbeacon/shared";

export const isTransactionConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2034" || ["40P01", "40001"].includes(errorCode(error) ?? ""));

export const retryOnTransactionConflict = async <T>(run: () => Promise<T>) => {
  const first = await tryCatch(run());
  if (!first.error) return first.data;
  if (!isTransactionConflict(first.error)) throw first.error;
  return run();
};
