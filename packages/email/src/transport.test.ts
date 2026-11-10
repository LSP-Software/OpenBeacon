import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";

const sendMail = mock(async (_message: unknown) => ({}));
const smtpVerify = mock(async () => true);
const resendSend = mock(async (_message: unknown) => ({ data: { id: "id" }, error: null }));
let domainsResult: unknown = { data: { data: [] }, error: null };
let domainResult: unknown = {
  data: { open_tracking: false, click_tracking: false },
  error: null,
};
const getDomain = mock(async (_id: string) => domainResult);

const createTransport = mock((_options: unknown) => ({ sendMail, verify: smtpVerify }));

mock.module("nodemailer", () => ({ default: { createTransport } }));
mock.module("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
    domains = { list: async () => domainsResult, get: getDomain };
  },
}));

const { createEmailTransport } = await import("./transport.ts");
afterAll(() => mock.restore());

const logo = Buffer.from("logo");
const message = {
  to: "owner@example.com",
  subject: "Subject",
  html: '<img src="cid:openbeacon-logo">',
  text: "Body",
  summary: { type: "password-reset", code: "042917" },
  attachments: [{ filename: "openbeacon.png", content: logo, contentId: "openbeacon-logo" }],
};

describe("SMTP transport", () => {
  const smtpConfig = {
    transport: "smtp",
    fromAddress: "noreply@example.com",
    host: "smtp.example.com",
    port: 587,
    secure: false,
    requireTls: true,
    auth: null,
  } as const;
  const transport = createEmailTransport(smtpConfig);

  test("refuses to send unless STARTTLS succeeds", () => {
    createEmailTransport(smtpConfig);
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    );
  });

  test("allows a plaintext relay when requireTls is off", () => {
    createEmailTransport({
      transport: "smtp",
      fromAddress: "noreply@example.com",
      host: "relay.local",
      port: 25,
      secure: false,
      requireTls: false,
      auth: null,
    });
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: "relay.local", requireTLS: false }),
    );
  });

  test("sends HTML, text and the logo as an inline cid attachment", async () => {
    await transport.send(message);
    expect(sendMail).toHaveBeenCalledWith({
      from: "OpenBeacon <noreply@example.com>",
      to: "owner@example.com",
      subject: "Subject",
      html: '<img src="cid:openbeacon-logo">',
      text: "Body",
      attachments: [{ filename: "openbeacon.png", content: logo, cid: "openbeacon-logo" }],
    });
  });

  test("reports the error code without the server's message", async () => {
    smtpVerify.mockImplementationOnce(async () => {
      throw Object.assign(new Error("535 login failed for owner@example.com"), { code: "EAUTH" });
    });
    await expect(transport.verify()).rejects.toThrow("SMTP connection or login failed (EAUTH)");
    smtpVerify.mockImplementationOnce(async () => {
      throw Object.assign(new Error("535 login failed for owner@example.com"), {
        code: "EAUTH",
        responseCode: 535,
      });
    });
    await expect(transport.verify()).rejects.toThrow("SMTP connection or login failed (EAUTH 535)");
  });

  test("reports why a send failed without addresses or content", async () => {
    sendMail.mockImplementationOnce(async () => {
      throw Object.assign(new Error("550 owner@example.com: mailbox unavailable"), {
        code: "EENVELOPE",
        responseCode: 550,
        response: "550 owner@example.com: mailbox unavailable",
      });
    });
    const error = await transport.send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).toBe(
      "SMTP could not send email (EENVELOPE 550)",
    );
    sendMail.mockImplementationOnce(async () => {
      throw new Error("Connection closed");
    });
    await expect(transport.send(message)).rejects.toThrow(/^SMTP could not send email$/);
  });
});

describe("Resend transport", () => {
  const transport = createEmailTransport({
    transport: "resend",
    fromAddress: "noreply@example.com",
    apiKey: "re_key",
  });

  test("sends HTML, text and the logo with its content id", async () => {
    await transport.send(message);
    expect(resendSend).toHaveBeenCalledWith({
      from: "OpenBeacon <noreply@example.com>",
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments,
    });
  });

  test("accepts a sending-only key", async () => {
    domainsResult = { data: null, error: { name: "restricted_api_key" } };
    await transport.verify();
  });

  test("rejects an invalid key", async () => {
    domainsResult = { data: null, error: { name: "invalid_api_key" } };
    await expect(transport.verify()).rejects.toThrow(
      "Resend rejected the API key: invalid_api_key",
    );
  });

  test("requires the sender domain to be verified", async () => {
    domainsResult = {
      data: {
        data: [
          { id: "pending", name: "example.com", status: "pending" },
          { id: "other", name: "other.com", status: "verified" },
        ],
      },
      error: null,
    };
    await expect(transport.verify()).rejects.toThrow(
      "The EMAIL_FROM domain is not verified in Resend",
    );
    domainsResult = {
      data: { data: [{ id: "example", name: "Example.com", status: "verified" }] },
      error: null,
    };
    await transport.verify();
    expect(getDomain).toHaveBeenLastCalledWith("example");
  });

  test("requires open and click tracking to be off for the sender domain", async () => {
    domainsResult = {
      data: { data: [{ id: "example", name: "example.com", status: "verified" }] },
      error: null,
    };
    for (const tracking of [
      { open_tracking: true, click_tracking: false },
      { open_tracking: false, click_tracking: true },
    ]) {
      domainResult = { data: tracking, error: null };
      await expect(transport.verify()).rejects.toThrow(
        "Turn off open tracking and click tracking for the EMAIL_FROM domain in Resend",
      );
    }
    domainResult = { data: null, error: { name: "not_found" } };
    await expect(transport.verify()).rejects.toThrow(
      "Resend could not read the EMAIL_FROM domain: not_found",
    );
    domainResult = { data: { open_tracking: false, click_tracking: false }, error: null };
    await transport.verify();
  });
});

describe("console transport", () => {
  test("prints one line with the recipient, type and code", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const transport = createEmailTransport({
      transport: "console",
      fromAddress: "noreply@localhost",
    });
    await transport.send(message);
    await transport.send({ ...message, summary: { type: "account-exists" } });
    expect(log.mock.calls).toEqual([
      ["[email] to=owner@example.com type=password-reset code=042917"],
      ["[email] to=owner@example.com type=account-exists"],
    ]);
    log.mockRestore();
  });
});
