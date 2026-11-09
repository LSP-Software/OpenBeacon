import { Text } from "@react-email/components";
import { renderEmailLayout } from "./layout.tsx";
import type { EmailCodePurpose, EmailMessage } from "./types.ts";

const content = {
  "sign-up": {
    subject: "Your OpenBeacon sign-up code",
    action: "finish creating your OpenBeacon account",
    ignore: "If you didn't try to create an account, you can ignore this email.",
  },
  "password-reset": {
    subject: "Your OpenBeacon password reset code",
    action: "reset your OpenBeacon password",
    ignore:
      "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
  },
  "recovery-reset": {
    subject: "Your OpenBeacon recovery phrase reset code",
    action: "confirm resetting your recovery phrase",
    ignore:
      "If you didn't ask to reset your recovery phrase, don't enter this code. Change your password in the app, because someone else may be signed in to your account.",
  },
} satisfies Record<EmailCodePurpose, { subject: string; action: string; ignore: string }>;

export const renderCodeEmail = async ({
  purpose,
  code,
  serverName,
}: {
  purpose: EmailCodePurpose;
  code: string;
  serverName: string;
}): Promise<Omit<EmailMessage, "to">> => {
  const { subject, action, ignore } = content[purpose];
  const rendered = await renderEmailLayout({
    serverName,
    preview: `Use this code in the app to ${action}.`,
    children: (
      <>
        <Text style={{ margin: "0 0 16px" }}>
          Enter this code in the OpenBeacon app to {action}:
        </Text>
        <Text
          style={{
            fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
            fontSize: "32px",
            fontWeight: 700,
            letterSpacing: "8px",
            lineHeight: "40px",
            margin: "0 0 16px",
          }}
        >
          {code}
        </Text>
        <Text style={{ margin: "0 0 16px" }}>The code expires in 10 minutes and works once.</Text>
        <Text style={{ margin: 0 }}>{ignore}</Text>
      </>
    ),
  });
  return { subject, ...rendered };
};
