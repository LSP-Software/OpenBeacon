import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { checkBucketAccess, createStorageClients } from "./storage.ts";

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

describe("createStorageClients", () => {
  const hangingServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data: () => {} },
  });
  afterAll(() => hangingServer.stop(true));

  test("the main client gives up on a stalled request, and part uploads have no whole-request limit", async () => {
    const clients = createStorageClients({
      MAP_S3_ENDPOINT: "https://map-storage.example.com",
      MAP_S3_REGION: "us-east-1",
      MAP_S3_FORCE_PATH_STYLE: false,
      MAP_S3_ACCESS_KEY_ID: "key-id",
      MAP_S3_ACCESS_KEY: "secret",
    });

    const configOf = async (client: typeof clients.client) => {
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
    expect(await configOf(clients.client)).toMatchObject({
      connectionTimeout: 30_000,
      requestTimeout: 120_000,
      throwOnRequestTimeout: true,
    });
    expect(await configOf(clients.partClient)).toMatchObject({
      connectionTimeout: 30_000,
      requestTimeout: undefined,
    });
  });

  test("puts the bucket in the path only when asked", () => {
    const env = {
      MAP_S3_ENDPOINT: "https://map-storage.example.com",
      MAP_S3_REGION: "us-east-1",
      MAP_S3_ACCESS_KEY_ID: "key-id",
      MAP_S3_ACCESS_KEY: "secret",
    };

    for (const forcePathStyle of [false, true]) {
      const clients = createStorageClients({ ...env, MAP_S3_FORCE_PATH_STYLE: forcePathStyle });
      expect(clients.client.config.forcePathStyle).toBe(forcePathStyle);
      expect(clients.partClient.config.forcePathStyle).toBe(forcePathStyle);
    }
  });
});
