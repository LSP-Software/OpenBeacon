import type { devicePlatformSchema } from "@openbeacon/schemas";
import type { z } from "zod";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  summary: { type: string; code?: string };
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
  "new-sign-in": "alertNewSignIn",
  "deletion-scheduled": "alertDeletionScheduled",
} as const;

export type OptionalSecurityAlert = keyof typeof optionalSecurityAlerts;

export type AlertDevice = {
  name: string;
  model: string | null;
  platform: z.infer<typeof devicePlatformSchema> | null;
};

export type SecurityAlert =
  | {
      type:
        | "password-changed"
        | "password-reset"
        | "recovery-phrase-changed"
        | "recovery-phrase-reset"
        | "account-deleted";
    }
  | { type: "other-sessions-signed-out"; device: AlertDevice | null }
  | { type: "device-removed"; device: AlertDevice }
  | {
      type: "new-sign-in";
      device: { model: string | null; platform: z.infer<typeof devicePlatformSchema> | null };
    }
  | { type: "deletion-scheduled"; deletionDate: Date }
  | { type: "alerts-turned-off"; alerts: OptionalSecurityAlert[] };

export const isOptionalSecurityAlert = (
  type: SecurityAlert["type"],
): type is OptionalSecurityAlert => type in optionalSecurityAlerts;
