import { afterAll, expect, mock, test } from "bun:test";
import { SERVER_UNREACHABLE_MESSAGE } from "./serverUnreachable.ts";

const hangingServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data: () => {} },
});
const closingServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { open: (socket) => socket.terminate(), data: () => {} },
});

const baseUrl = `http://127.0.0.1:${hangingServer.port.toString()}`;
mock.module("./storage.ts", () => ({
  storage: { getString: () => undefined, set: () => {}, remove: () => {}, contains: () => false },
}));
mock.module("./currentServer.ts", () => ({ baseUrl }));
mock.module("expo-secure-store", () => ({}));
mock.module("@better-auth/expo/client", () => ({ expoClient: () => ({ id: "expo" }) }));

const { authClient }: typeof import("./auth-client.ts") = await import("./auth-client.ts");

afterAll(() => {
  hangingServer.stop(true);
  closingServer.stop(true);
});

const unreachable = {
  status: 503,
  code: "SERVER_UNREACHABLE",
  message: SERVER_UNREACHABLE_MESSAGE,
};

test("sign-in against a server that never answers returns an error at the timeout", async () => {
  const start = performance.now();
  const result = await authClient.signIn.email(
    { email: "person@example.com", password: "password" },
    { timeout: 100 },
  );

  expect(result.data).toBeNull();
  expect(result.error).toMatchObject(unreachable);
  expect(performance.now() - start).toBeLessThan(2_000);
});

test("a call that passes its own signal still gives up at the timeout", async () => {
  const start = performance.now();
  const result = await authClient.getSession({
    fetchOptions: { signal: new AbortController().signal, timeout: 100 },
  });

  expect(result.error).toMatchObject(unreachable);
  expect(performance.now() - start).toBeLessThan(2_000);
});

test("aborting the caller's signal throws instead of reporting the server as unreachable", async () => {
  const controller = new AbortController();
  const request = authClient.getSession({
    fetchOptions: { signal: controller.signal, timeout: 10_000 },
  });
  controller.abort();

  await expect(request).rejects.toThrow();
});

test("sign-in against a server that drops the connection returns an error", async () => {
  const result = await authClient.$fetch("/sign-in/email", {
    baseURL: `http://127.0.0.1:${closingServer.port.toString()}/api/auth`,
    method: "POST",
    body: { email: "person@example.com", password: "password" },
  });

  expect(result.error).toMatchObject(unreachable);
});
