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

export const invalidCodeMessage = "The code is wrong or has expired. Check it, or send a new code.";

type CodeRejections = { total: number; codes: number; currentCodeRejected: boolean };

export const noCodeRejections: CodeRejections = { total: 0, codes: 0, currentCodeRejected: false };

export const recordCodeRejection = (rejections: CodeRejections): CodeRejections => ({
  total: rejections.total + 1,
  codes: rejections.currentCodeRejected ? rejections.codes : rejections.codes + 1,
  currentCodeRejected: true,
});

export const recordNewCode = (rejections: CodeRejections): CodeRejections => ({
  ...rejections,
  currentCodeRejected: false,
});

export const codeEntryErrorMessage = (
  error: string,
  rejections: CodeRejections,
  repeatedInvalidCodeHint: string,
) =>
  error === invalidCodeMessage && (rejections.codes > 1 || rejections.total > 5)
    ? `${error} ${repeatedInvalidCodeHint}`
    : error;

export const emailCodeErrorMessage = (error: {
  status: number;
  code?: string | undefined;
  message?: string | undefined;
}) => {
  if (error.status === 429) {
    return "Too many codes have been requested. Try again in a few minutes.";
  }
  if (error.code === "INVALID_CODE") return invalidCodeMessage;
  return error.message ?? "Something went wrong. Please try again.";
};
