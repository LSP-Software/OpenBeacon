import { Text } from "@react-email/components";
import { renderEmailLayout } from "./layout.tsx";
import type { EmailMessage } from "./types.ts";

export const renderGoogleSignInEmail = async ({
  serverName,
}: {
  serverName: string;
}): Promise<Omit<EmailMessage, "to">> => {
  const rendered = await renderEmailLayout({
    serverName,
    preview: "Someone asked to reset the password for your OpenBeacon account.",
    children: (
      <>
        <Text style={{ margin: "0 0 16px" }}>
          Someone asked to reset the password for the OpenBeacon account that uses this email
          address. Your account signs in with Google, so it has no password to reset.
        </Text>
        <Text style={{ margin: "0 0 16px" }}>
          If this was you, open the OpenBeacon app and tap Continue with Google on the sign-in
          screen. If you can't get into your Google account, recover it with Google first.
        </Text>
        <Text style={{ margin: 0 }}>
          If this wasn't you, you can safely ignore this email. Nothing about your account has
          changed.
        </Text>
      </>
    ),
  });
  return { subject: "Signing in to OpenBeacon with Google", ...rendered };
};
