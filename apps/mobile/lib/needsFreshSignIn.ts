import { errorReason } from "./errorReason.ts";

export const needsFreshSignIn = (error: unknown) => errorReason(error) === "FRESH_SIGN_IN_REQUIRED";
