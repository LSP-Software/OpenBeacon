import { tryCatch } from "@openbeacon/shared";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { EmailConfig, EmailTransport } from "./types.ts";

export const createEmailTransport = (
  config: Exclude<EmailConfig, { transport: "none" }>,
): EmailTransport => {
  const from = `OpenBeacon <${config.fromAddress}>`;

  if (config.transport === "console") {
    return {
      send: async ({ subject, text }) => {
        console.log(`Email from ${from}\nSubject: ${subject}\n\n${text}`);
      },
      verify: async () => {},
    };
  }

  if (config.transport === "resend") {
    const resend = new Resend(config.apiKey);
    return {
      send: async (message) => {
        const result = await resend.emails.send({ from, ...message });
        if (result.error) throw new Error(`Resend could not send email: ${result.error.name}`);
      },
      verify: async () => {
        const result = await resend.domains.list({ limit: 100 });
        // Resend has no endpoint for checking a send-only key. A restricted_api_key error means the key is valid but can only send.
        if (result.error?.name === "restricted_api_key") return;
        if (result.error) throw new Error(`Resend rejected the API key: ${result.error.name}`);
        const domain = config.fromAddress.split("@")[1]?.toLowerCase();
        const verified = result.data.data.find(
          (entry) => entry.name.toLowerCase() === domain && entry.status === "verified",
        );
        if (!verified) {
          throw new Error("The EMAIL_FROM domain is not verified in Resend");
        }
        const details = await resend.domains.get(verified.id);
        if (details.error) {
          throw new Error(`Resend could not read the EMAIL_FROM domain: ${details.error.name}`);
        }
        if (details.data.open_tracking || details.data.click_tracking) {
          throw new Error(
            "Turn off open tracking and click tracking for the EMAIL_FROM domain in Resend",
          );
        }
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 30000,
    ...(config.auth ? { auth: config.auth } : {}),
  });
  return {
    send: async (message) => {
      const result = await tryCatch(
        transporter.sendMail({
          from,
          ...message,
          attachments: message.attachments.map(({ filename, content, contentId }) => ({
            filename,
            content,
            cid: contentId,
          })),
        }),
      );
      if (result.error) throw new Error("SMTP could not send email");
    },
    verify: async () => {
      const result = await tryCatch(transporter.verify());
      if (!result.error) return;
      const code =
        "code" in result.error && typeof result.error.code === "string" ? result.error.code : null;
      throw new Error(`SMTP connection or login failed${code ? ` (${code})` : ""}`);
    },
  };
};
