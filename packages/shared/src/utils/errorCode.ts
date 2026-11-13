const field = (value: unknown, key: string) =>
  value instanceof Object && key in value ? (value as Record<string, unknown>)[key] : undefined;

export const errorCode = (error: unknown) => {
  const postgresCode = field(
    field(field(field(error, "meta"), "driverAdapterError"), "cause"),
    "originalCode",
  );
  if (typeof postgresCode === "string") return postgresCode;
  const code = field(error, "code");
  return typeof code === "string" ? code : null;
};
