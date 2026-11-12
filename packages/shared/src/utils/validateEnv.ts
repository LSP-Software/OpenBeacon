export const validateEnv = ({
  checks = [],
  schemas,
  source,
}: {
  checks?: (() => string | null)[];
  schemas: Record<
    string,
    {
      safeParse: (
        value: unknown,
      ) => { success: true } | { success: false; error: { issues: { message: string }[] } };
    }
  >;
  source: Record<string, string | undefined>;
}) => {
  let valid = true;

  console.log("Environment configuration:");
  for (const [name, schema] of Object.entries(schemas)) {
    const value = source[name];
    const result = schema.safeParse(value);
    if (!result.success) {
      valid = false;
      console.error(`  ${name}: invalid (${result.error.issues[0]?.message ?? "unknown error"})`);
    } else {
      console.log(
        `  ${name}: ${value === undefined || value.trim() === "" ? "not set (optional/default)" : "valid"}`,
      );
    }
  }

  for (const check of checks) {
    const error = check();
    if (error) {
      valid = false;
      console.error(`  ${error}`);
    }
  }

  if (!valid) {
    throw new Error("Environment configuration validation failed");
  }
  console.log("Environment configuration valid");
};
