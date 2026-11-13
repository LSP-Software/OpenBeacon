import { afterAll, expect, spyOn, test } from "bun:test";

const hangingServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data: () => {} },
});
process.env["RESEND_BASE_URL"] = `http://127.0.0.1:${hangingServer.port.toString()}`;

const timeout = AbortSignal.timeout.bind(AbortSignal);
const requestedTimeouts: number[] = [];
const shortTimeout = spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
  requestedTimeouts.push(ms);
  return timeout(100);
});

const { createEmailTransport } = await import("./transport.ts");

afterAll(() => {
  shortTimeout.mockRestore();
  hangingServer.stop(true);
});

const transport = createEmailTransport({
  transport: "resend",
  fromAddress: "noreply@example.com",
  apiKey: "re_key",
});

test("a send to a Resend that never answers fails at its timeout", async () => {
  requestedTimeouts.length = 0;
  const start = performance.now();

  await expect(
    transport.send({
      to: "owner@example.com",
      subject: "Subject",
      html: "<p>Body</p>",
      text: "Body",
      summary: { type: "password-reset", code: "042917" },
      attachments: [],
    }),
  ).rejects.toThrow("Resend could not send email");
  expect(performance.now() - start).toBeLessThan(2_000);
  expect(requestedTimeouts).toEqual([15_000]);
});

test("checking the key against a Resend that never answers fails at its timeout", async () => {
  requestedTimeouts.length = 0;
  const start = performance.now();

  await expect(transport.verify()).rejects.toThrow("Resend rejected the API key");
  expect(performance.now() - start).toBeLessThan(2_000);
  expect(requestedTimeouts).toEqual([15_000]);
});
