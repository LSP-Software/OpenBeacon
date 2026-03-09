import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  plugins: [expo()],
  emailAndPassword: {
    enabled: true,
  },
});
