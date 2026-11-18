import { tryCatch } from "@openbeacon/shared";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { EmailConfig, EmailTransport } from "./types.ts";

const smtpErrorDetails = (error: Error) => {
  const details = [
    "code" in error && typeof error.code === "string" ? error.code : null,
    "responseCode" in error && typeof error.responseCode === "number" ? error.responseCode : null,
  ].filter((detail) => detail !== null);
  return details.length > 0 ? ` (${details.join(" ")})` : "";
};

export const emailUnreachableCode = "EMAIL_UNREACHABLE";

const unreachable = (message: string) =>
  Object.assign(new Error(message), { code: emailUnreachableCode });

const resendUnreachable = (error: { statusCode?: number | null }) =>
  error.statusCode === null ||
  (error.statusCode !== undefined && (error.statusCode === 429 || error.statusCode >= 500));

export const createEmailTransport = (
  config: Exclude<EmailConfig, { transport: "none" }>,
): EmailTransport => {
  const from = `OpenBeacon <${config.fromAddress}>`;

  if (config.transport === "console") {
    return {
      send: async ({ to, summary }) => {
        console.log(
          `[email] to=${to} type=${summary.type}${summary.code ? ` code=${summary.code}` : ""}`,
        );
      },
      verify: async () => {},
    };
  }

  if (config.transport === "resend") {
    const resend = new Resend(config.apiKey);
    return {
      send: async ({ summary: _summary, ...message }) => {
        const result = await resend.emails.send(
          { from, ...message },
          { signal: AbortSignal.timeout(15_000) },
        );
        if (result.error) throw new Error(`Resend could not send email: ${result.error.name}`);
      },
      verify: async () => {
        const listed = await tryCatch(
          resend.domains.list({ limit: 100 }, { signal: AbortSignal.timeout(15_000) }),
        );
        if (listed.error) throw unreachable("Resend could not be reached");
        const result = listed.data;
        // Resend has no endpoint for checking a send-only key. A restricted_api_key error means the key is valid but can only send.
        if (result.error?.name === "restricted_api_key") return;
        if (result.error && resendUnreachable(result.error))
          throw unreachable(`Resend could not be reached: ${result.error.name}`);
        if (result.error) throw new Error(`Resend rejected the API key: ${result.error.name}`);
        const domain = config.fromAddress.split("@")[1]?.toLowerCase();
        const verified = result.data.data.find(
          (entry) => entry.name.toLowerCase() === domain && entry.status === "verified",
        );
        if (!verified) {
          throw new Error("The EMAIL_FROM domain is not verified in Resend");
        }
        const fetched = await tryCatch(
          resend.domains.get(verified.id, { signal: AbortSignal.timeout(15_000) }),
        );
        if (fetched.error) throw unreachable("Resend could not be reached");
        const details = fetched.data;
        if (details.error && resendUnreachable(details.error))
          throw unreachable(`Resend could not be reached: ${details.error.name}`);
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
    send: async ({ summary: _summary, ...message }) => {
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
      if (result.error) {
        throw new Error(`SMTP could not send email${smtpErrorDetails(result.error)}`);
      }
    },
    verify: async () => {
      const result = await tryCatch(transporter.verify());
      if (!result.error) return;
      const code = "code" in result.error ? result.error.code : null;
      const responseCode = "responseCode" in result.error ? result.error.responseCode : null;
      if (
        (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) ||
        (typeof responseCode !== "number" &&
          ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(String(code)))
      )
        throw unreachable(`SMTP server could not be reached${smtpErrorDetails(result.error)}`);
      throw new Error(`SMTP connection or login failed${smtpErrorDetails(result.error)}`);
    },
  };
};
