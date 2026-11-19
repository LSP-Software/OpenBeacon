import { errorCode, tryCatch } from "@openbeacon/shared";

const checkTimedOut = "SERVICE_CHECK_TIMED_OUT";

export const checkOptionalServices = async (
  checks: Record<
    string,
    { check: () => Promise<unknown>; isUnreachable: (error: Error) => boolean }
  >,
  timeoutMs = 9_000,
) => {
  const results = await Promise.all(
    Object.entries(checks).map(async ([name, { check, isUnreachable }]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await tryCatch(
        Promise.race([
          Promise.resolve().then(check),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(Object.assign(new Error("Timed out"), { code: checkTimedOut })),
              timeoutMs,
            );
          }),
        ]),
      );
      clearTimeout(timer);
      if (!result.error) {
        console.log(`  ${name}: valid`);
        return true;
      }
      const code = errorCode(result.error);
      if (code === checkTimedOut || isUnreachable(result.error)) {
        console.warn(
          `  ${name}: unreachable${code ? ` (${code})` : ""}, starting anyway; it is tried again each time it is needed`,
        );
        return true;
      }
      console.error(`  ${name}: failed${code ? ` (${code})` : ""}`);
      return false;
    }),
  );
  if (results.some((result) => !result)) {
    throw new Error("Service configuration validation failed");
  }
};
