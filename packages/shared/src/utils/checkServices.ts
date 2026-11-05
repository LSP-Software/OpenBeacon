import { tryCatch } from "./tryCatch.ts";

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
        console.error(`  ${name}: failed`);
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
