import type {
  devicePlatformSchema,
  notificationChannelSchema,
  notificationTypes,
} from "@openbeacon/schemas";
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
  | { type: "alerts-turned-off"; alerts: TurnedOffNotification[] };

type NotificationType = keyof typeof notificationTypes;

export type TurnedOffNotification = {
  type: NotificationType;
  channel: z.infer<typeof notificationChannelSchema>;
};

export const securityAlertSettings = {
  "new-sign-in": "NEW_SIGN_IN",
  "password-changed": "PASSWORD_CHANGED",
  "password-reset": "PASSWORD_CHANGED",
  "recovery-phrase-changed": "RECOVERY_PHRASE_CHANGED",
  "recovery-phrase-reset": "RECOVERY_PHRASE_CHANGED",
  "other-sessions-signed-out": "OTHER_SESSIONS_SIGNED_OUT",
  "device-removed": "DEVICE_REMOVED",
  "deletion-scheduled": "DELETION_SCHEDULED",
  "account-deleted": null,
  "alerts-turned-off": null,
} as const satisfies Record<SecurityAlert["type"], NotificationType | null>;
