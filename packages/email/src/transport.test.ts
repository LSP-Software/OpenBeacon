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
  attachments: [{ filename: "openbeacon.png", content: logo, contentId: "openbeacon-logo" }],
};

describe("SMTP transport", () => {
  const transport = createEmailTransport({
    transport: "smtp",
    fromAddress: "noreply@example.com",
    host: "smtp.example.com",
    port: 587,
    secure: false,
    requireTls: true,
    auth: null,
  });

  test("refuses to send unless STARTTLS succeeds", () => {
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
      ...message,
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
  test("prints the plain-text part without the recipient's address", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    await createEmailTransport({ transport: "console", fromAddress: "noreply@localhost" }).send(
      message,
    );
    expect(log).toHaveBeenCalledWith(
      "Email from OpenBeacon <noreply@localhost>\nSubject: Subject\n\nBody",
    );
    log.mockRestore();
  });
});
