let nextLogAt = 0;
let suppressed = 0;

export const logRateLimit = (details: { path: string; scope: "userId" | "server" | "auth" }) => {
  const now = Date.now();
  if (now < nextLogAt) {
    suppressed += 1;
    return;
  }

  console.warn("[rate-limit] request limited", { ...details, suppressed });
  suppressed = 0;
  nextLogAt = now + 60_000;
};
