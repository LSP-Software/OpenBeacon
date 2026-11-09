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
      auth: { user: string; pass: string } | null;
    };

export type EmailTransport = {
  send: (message: EmailMessage) => Promise<void>;
  verify: () => Promise<void>;
};

export type EmailCodePurpose =
  "sign-up" | "email-verification" | "password-reset" | "recovery-reset";
