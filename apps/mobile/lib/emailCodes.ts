import { authClient } from "./auth-client.ts";

const post = <Data>(path: string, body: Record<string, string>) =>
  authClient.$fetch<Data>(path, { method: "POST", body });

export const emailCodes = {
  requestSignUpCode: (email: string) =>
    post<{ success: boolean }>("/email-code/request-sign-up-code", { email }),
  verifySignUpCode: (email: string, code: string) =>
    post<{ signUpToken: string }>("/email-code/verify-sign-up-code", { email, code }),
  requestEmailVerification: (email: string, password: string) =>
    post<{ success: boolean }>("/email-code/request-email-verification", { email, password }),
  verifyEmail: (email: string, code: string) =>
    post<{ success: boolean }>("/email-code/verify-email", { email, code }),
  requestPasswordReset: (email: string) =>
    post<{ success: boolean }>("/email-code/request-password-reset", { email }),
  verifyPasswordResetCode: (email: string, code: string) =>
    post<{ resetToken: string }>("/email-code/verify-password-reset-code", { email, code }),
};

export const emailCodeErrorMessage = (error: {
  status: number;
  code?: string | undefined;
  message?: string | undefined;
}) => {
  if (error.status === 429) {
    return "Too many codes have been requested. Try again in a few minutes.";
  }
  if (error.code === "INVALID_CODE") {
    return "The code is wrong or has expired. Check it, or send a new code.";
  }
  return error.message ?? "Something went wrong. Please try again.";
};
