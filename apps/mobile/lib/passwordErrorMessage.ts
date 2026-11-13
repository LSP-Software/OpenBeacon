export const passwordErrorMessage = (
  error: { code?: string | undefined; message?: string | undefined },
  fallbackMessage: string,
) =>
  error.code === "TOO_MANY_PASSWORD_ATTEMPTS"
    ? "Too many attempts. Try again in 15 minutes."
    : error.message || fallbackMessage;
