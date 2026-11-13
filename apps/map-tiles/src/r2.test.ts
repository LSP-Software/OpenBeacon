import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { checkBucketAccess, createR2Clients } from "./r2.ts";

describe("checkBucketAccess", () => {
  test("lists, writes and deletes a small object", async () => {
    const send = mock(async (_command: unknown, _options: unknown) => ({}));

    await checkBucketAccess({ bucket: "maps", client: { send } as unknown as S3Client });

    const commands = send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(commands[1]).toBeInstanceOf(PutObjectCommand);
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[1] as PutObjectCommand).input).toMatchObject({
      Bucket: "maps",
      Key: "map-tiles-access-check",
    });
    expect((commands[2] as DeleteObjectCommand).input).toEqual({
      Bucket: "maps",
      Key: "map-tiles-access-check",
    });
  });

  test("fails when the credentials can only read", async () => {
    const send = mock(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        throw Object.assign(new Error("Access Denied"), { name: "AccessDenied" });
      }
      return {};
    });

    await expect(
      checkBucketAccess({ bucket: "maps", client: { send } as unknown as S3Client }),
    ).rejects.toThrow("Access Denied");
  });
});

describe("createR2Clients", () => {
  const hangingServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data: () => {} },
  });
  afterAll(() => hangingServer.stop(true));

  test("both clients give up on a stalled request instead of only logging a warning", async () => {
    const clients = createR2Clients({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key-id",
      R2_SECRET_ACCESS_KEY: "secret",
    });

    for (const client of [clients.client, clients.partClient]) {
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
      expect("httpHandlerConfigs" in handler ? handler.httpHandlerConfigs() : null).toMatchObject({
        connectionTimeout: 30_000,
        requestTimeout: 120_000,
        throwOnRequestTimeout: true,
      });
    }
  });
});
