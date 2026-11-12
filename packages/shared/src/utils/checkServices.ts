import { tryCatch } from "./tryCatch.ts";

const failureCode = (error: unknown) => {
  if (!(error instanceof Error)) {
    return null;
  }
  if ("code" in error && typeof error.code === "string" && /^[\w.-]{1,64}$/.test(error.code)) {
    return error.code;
  }
  return error.name !== "Error" && /^\w{1,64}$/.test(error.name) ? error.name : null;
};

export const checkServices = async (checks: Record<string, () => Promise<unknown>>) => {
  console.log("Service connectivity:");
  const results = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await tryCatch(
        Promise.race([
          Promise.resolve().then(check),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Service check timed out")), 10000);
          }),
        ]),
      );
      clearTimeout(timer);
      if (result.error) {
        const code = failureCode(result.error);
        console.error(`  ${name}: failed${code ? ` (${code})` : ""}`);
        return false;
      }
      console.log(`  ${name}: valid`);
      return true;
    }),
  );
  if (results.some((result) => !result)) {
    throw new Error("Service connectivity validation failed");
  }
};
