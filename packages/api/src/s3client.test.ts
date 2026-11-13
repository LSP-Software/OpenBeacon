import { afterAll, expect, test } from "bun:test";
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { r2Client } from "./r2.ts";
import { createStorageClient, s3Client } from "./s3client.ts";

const hangingServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data: () => {} },
});

afterAll(() => hangingServer.stop(true));

const handlerConfig = async (client: S3Client) => {
  const handler = await client.config.requestHandler;
  await handler
    .handle(
      {
        method: "GET",
        protocol: "http:",
        hostname: "127.0.0.1",
        port: hangingServer.port,
        path: "/",
        query: {},
        headers: {},
      },
      { abortSignal: AbortSignal.timeout(50) },
    )
    .catch(() => {});
  return "httpHandlerConfigs" in handler ? handler.httpHandlerConfigs() : null;
};

test("the image and map storage clients time out connections and requests", async () => {
  for (const client of [s3Client, r2Client]) {
    expect(await handlerConfig(client)).toMatchObject({
      connectionTimeout: 5_000,
      requestTimeout: 15_000,
      throwOnRequestTimeout: true,
    });
  }
});

test("a storage call to a server that never answers gives up at the request timeout", async () => {
  const client = createStorageClient(
    {
      endpoint: `http://127.0.0.1:${hangingServer.port.toString()}`,
      region: "us-east-1",
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId: "key", secretAccessKey: "secret" },
    },
    { connectionTimeout: 200, requestTimeout: 200 },
  );
  const start = performance.now();

  await expect(
    client.send(new HeadObjectCommand({ Bucket: "bucket", Key: "key" })),
  ).rejects.toThrow("requestTimeout");
  expect(performance.now() - start).toBeLessThan(2_000);
});
