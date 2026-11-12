import { Text } from "@react-email/components";
import { renderEmailLayout } from "./layout.tsx";
import type { EmailMessage } from "./types.ts";

export const renderAccountExistsEmail = async ({
  hasPassword,
  serverName,
}: {
  hasPassword: boolean;
  serverName: string;
}): Promise<Omit<EmailMessage, "to">> => {
  const rendered = await renderEmailLayout({
    serverName,
    title: "Account already exists",
    preview: "Someone tried to create an account with this email address.",
    children: (
      <>
        <Text style={{ margin: "0 0 16px" }}>
          Someone tried to create an OpenBeacon account with this email address, but you already
          have one.
        </Text>
        <Text style={{ margin: "0 0 16px" }}>
          {hasPassword
            ? "Sign in with your email and password instead. If you've forgotten your password, you can reset it from the sign-in screen."
            : "Sign in with Google instead."}
        </Text>
        <Text style={{ margin: 0 }}>
          If this wasn't you, you can ignore this email. Nobody can create another account with your
          address.
        </Text>
      </>
    ),
  });
  return {
    subject: "You already have an OpenBeacon account",
    summary: { type: "account-exists" },
    ...rendered,
  };
};
