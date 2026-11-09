import { Section, Text } from "@react-email/components";
import { emailColors, renderEmailLayout } from "./layout.tsx";
import type { EmailCodePurpose, EmailMessage } from "./types.ts";

const content = {
  "sign-up": {
    subject: "Your OpenBeacon sign-up code",
    title: "Your sign-up code",
    action: "finish creating your OpenBeacon account",
    ignore: "If you didn't try to create an account, you can ignore this email.",
  },
  "email-verification": {
    subject: "Your OpenBeacon email verification code",
    title: "Verify your email",
    action: "verify your email address and finish signing in",
    ignore: "If you didn't try to sign in, you can ignore this email.",
  },
  "password-reset": {
    subject: "Your OpenBeacon password reset code",
    title: "Reset your password",
    action: "reset your OpenBeacon password",
    ignore:
      "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
  },
  "recovery-reset": {
    subject: "Your OpenBeacon recovery phrase reset code",
    title: "Reset your recovery phrase",
    action: "confirm resetting your recovery phrase",
    ignore:
      "If you didn't ask to reset your recovery phrase, don't enter this code. Change your password in the app, because someone else may be signed in to your account.",
  },
} satisfies Record<
  EmailCodePurpose,
  { subject: string; title: string; action: string; ignore: string }
>;

export const renderCodeEmail = async ({
  purpose,
  code,
  serverName,
}: {
  purpose: EmailCodePurpose;
  code: string;
  serverName: string;
}): Promise<Omit<EmailMessage, "to">> => {
  const { subject, title, action, ignore } = content[purpose];
  const rendered = await renderEmailLayout({
    serverName,
    title,
    preview: `Use this code in the app to ${action}.`,
    children: (
      <>
        <Text style={{ margin: "0 0 16px" }}>
          Enter this code in the OpenBeacon app to {action}:
        </Text>
        <Section
          style={{
            backgroundColor: emailColors.panel,
            borderRadius: "8px",
            padding: "20px",
            margin: "0 0 16px",
            textAlign: "center",
          }}
        >
          <Text
            style={{
              fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace",
              fontSize: "32px",
              fontWeight: 700,
              letterSpacing: "8px",
              lineHeight: "40px",
              margin: 0,
            }}
          >
            {code.slice(0, 3)}
            <span style={{ paddingLeft: "16px" }}>{code.slice(3)}</span>
          </Text>
        </Section>
        <Text style={{ margin: "0 0 16px" }}>The code expires in 10 minutes and works once.</Text>
        <Text style={{ margin: 0 }}>{ignore}</Text>
      </>
    ),
  });
  return { subject, ...rendered };
};
