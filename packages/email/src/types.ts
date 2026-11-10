import type { devicePlatformSchema } from "@openbeacon/schemas";
import type { z } from "zod";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: Buffer; contentId: string }[];
};

export type EmailConfig =
  | { transport: "none" }
  | { transport: "console"; fromAddress: string }
  | { transport: "resend"; fromAddress: string; apiKey: string }
  | {
      transport: "smtp";
      fromAddress: string;
      host: string;
      port: number;
      secure: boolean;
      requireTls: boolean;
      auth: { user: string; pass: string } | null;
    };

export type EmailTransport = {
  send: (message: EmailMessage) => Promise<void>;
  verify: () => Promise<void>;
};

export type EmailCodePurpose =
  "sign-up" | "email-verification" | "password-reset" | "recovery-reset";

export const optionalSecurityAlerts = {
  "new-device": "alertNewDevice",
  "deletion-scheduled": "alertDeletionScheduled",
} as const;

export type OptionalSecurityAlert = keyof typeof optionalSecurityAlerts;

export type SecurityAlert =
  | {
      type:
        | "password-changed"
        | "password-reset"
        | "recovery-phrase-changed"
        | "recovery-phrase-reset"
        | "other-sessions-signed-out"
        | "account-deleted";
    }
  | {
      type: "new-device";
      device: { model: string | null; platform: z.infer<typeof devicePlatformSchema> | null };
    }
  | { type: "deletion-scheduled"; deletionDate: Date }
  | { type: "alerts-turned-off"; alerts: OptionalSecurityAlert[] };

export const isOptionalSecurityAlert = (
  type: SecurityAlert["type"],
): type is OptionalSecurityAlert => type in optionalSecurityAlerts;
