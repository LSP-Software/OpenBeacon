import { describe, expect, mock, spyOn, test } from "bun:test";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { MapTilesManifest } from "./manifest.ts";
import { z } from "zod";
import {
  checkMapArchive,
  forcePathStyleSchema,
  mapStorageEnvSchema,
  runStorageCheck,
  s3EndpointSchema,
  storageFailureHint,
} from "./storage.ts";

const manifest: MapTilesManifest = {
  current: "b",
  slots: {
    a: null,
    b: {
      build: "20261101",
      key: "planet-b.pmtiles",
      publishedAt: "2026-11-01T00:00:00.000Z",
      schemaVersion: "4.15.2",
      size: 1,
    },
  },
};

const createClient = ({
  head = async () => ({}),
  stored,
}: {
  head?: () => Promise<unknown>;
  stored: MapTilesManifest | null;
}) => {
  const send = mock(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      if (!stored) {
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      }
      return {
        Body: { transformToString: async () => JSON.stringify(stored) },
        ETag: '"etag"',
      };
    }
    return head();
  });
  return { client: { send } as unknown as S3Client, send };
};

describe("checkMapArchive", () => {
  test("checks the archive in use exists", async () => {
    const { client, send } = createClient({ stored: manifest });
    await checkMapArchive({ bucket: "bucket", client });
    const [command] = send.mock.calls[1] ?? [];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect((command as HeadObjectCommand).input).toEqual({
      Bucket: "bucket",
      Key: "planet-b.pmtiles",
    });
  });

  test("only reads the bucket before the first map is published", async () => {
    const { client, send } = createClient({ stored: null });
    await checkMapArchive({ bucket: "bucket", client });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("fails when the archive in use is missing", async () => {
    const { client } = createClient({
      head: async () => {
        throw new Error("NotFound");
      },
      stored: manifest,
    });
    await expect(checkMapArchive({ bucket: "bucket", client })).rejects.toThrow("NotFound");
  });
});

describe("s3EndpointSchema", () => {
  const schema = s3EndpointSchema("MAP_S3");

  test("accepts an S3 API address with or without a trailing slash", () => {
    for (const url of [
      "https://account.r2.cloudflarestorage.com",
      "https://account.r2.cloudflarestorage.com/",
      "http://localhost:9000",
    ]) {
      expect(schema.safeParse(url).success).toBe(true);
    }
  });

  test("rejects an address with a bucket, path, query or hash and names the bucket setting", () => {
    for (const url of [
      "https://account.r2.cloudflarestorage.com/maps",
      "https://storage.example.com/s3/",
      "https://storage.example.com/?bucket=maps",
      "https://storage.example.com/#maps",
    ]) {
      const result = schema.safeParse(url);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        "must be the S3 API address without a bucket or path; put the bucket name in MAP_S3_BUCKET_NAME",
      );
    }
  });

  test("only allows http and https", () => {
    expect(schema.safeParse("ftp://storage.example.com").success).toBe(false);
    expect(schema.safeParse("account-id").success).toBe(false);
  });
});

describe("storage settings", () => {
  const required = {
    MAP_S3_ENDPOINT: "https://map-storage.example.com",
    MAP_S3_REGION: " auto ",
    MAP_S3_ACCESS_KEY_ID: " key ",
    MAP_S3_ACCESS_KEY: "secret\n",
    MAP_S3_BUCKET_NAME: " maps",
  };

  test("trims surrounding spaces", () => {
    expect(z.object(mapStorageEnvSchema).parse(required)).toMatchObject({
      MAP_S3_REGION: "auto",
      MAP_S3_ACCESS_KEY_ID: "key",
      MAP_S3_ACCESS_KEY: "secret",
      MAP_S3_BUCKET_NAME: "maps",
    });
  });

  test("rejects whitespace-only values", () => {
    for (const key of [
      "MAP_S3_REGION",
      "MAP_S3_ACCESS_KEY_ID",
      "MAP_S3_ACCESS_KEY",
      "MAP_S3_BUCKET_NAME",
    ] as const) {
      expect(z.object(mapStorageEnvSchema).safeParse({ ...required, [key]: "  " }).success).toBe(
        false,
      );
    }
  });

  test("reads path-style addressing with surrounding spaces and treats blank as unset", () => {
    expect(forcePathStyleSchema.parse(" true ")).toBe(true);
    expect(forcePathStyleSchema.parse("false")).toBe(false);
    expect(forcePathStyleSchema.parse("  ")).toBe(false);
    expect(forcePathStyleSchema.parse(undefined)).toBe(false);
    expect(forcePathStyleSchema.safeParse("sometimes").success).toBe(false);
  });
});

const s3Error = (name: string, httpStatusCode: number, extra: object = {}) =>
  Object.assign(new Error("secret-access-key-in-message"), {
    name,
    $metadata: { httpStatusCode },
    ...extra,
  });

const networkError = (code: string) =>
  Object.assign(new Error(`getaddrinfo ${code} storage.example.com`), {
    name: code === "ENOTFOUND" ? "DNSException" : "Error",
    code,
    $metadata: {},
  });

describe("storageFailureHint", () => {
  const hint = (error: unknown, forcePathStyle = false) =>
    storageFailureHint({ error, forcePathStyle, prefix: "IMAGES_S3" });

  test("points at the endpoint or path-style addressing when the host can't be found", () => {
    expect(hint(networkError("ENOTFOUND"))).toBe(
      "check IMAGES_S3_ENDPOINT, or set IMAGES_S3_FORCE_PATH_STYLE=true if your provider needs the bucket in the path",
    );
    expect(hint(networkError("ENOTFOUND"), true)).toBe("check IMAGES_S3_ENDPOINT");
    expect(hint(networkError("ECONNREFUSED"))).toBe("check IMAGES_S3_ENDPOINT");
  });

  test("suggests path-style addressing for a not found response only when it is off", () => {
    expect(hint(s3Error("NotFound", 404))).toBe(
      "check IMAGES_S3_ENDPOINT, or set IMAGES_S3_FORCE_PATH_STYLE=true if your provider needs the bucket in the path",
    );
    expect(hint(s3Error("NotFound", 404), true)).toBeNull();
  });

  test("points at the region for region mismatches", () => {
    for (const error of [
      s3Error("AuthorizationHeaderMalformed", 400, { Code: "AuthorizationHeaderMalformed" }),
      s3Error("PermanentRedirect", 301),
      s3Error("InvalidRegionName", 400),
      s3Error("Unknown", 301),
    ]) {
      expect(hint(error)).toBe("check IMAGES_S3_REGION");
    }
  });

  test("points at the bucket name when the bucket doesn't exist", () => {
    expect(hint(s3Error("NoSuchBucket", 404, { Code: "NoSuchBucket" }))).toBe(
      "check IMAGES_S3_BUCKET_NAME",
    );
  });

  test("points at the keys when they are wrong", () => {
    for (const name of ["InvalidAccessKeyId", "SignatureDoesNotMatch"]) {
      expect(hint(s3Error(name, 403))).toBe(
        "check IMAGES_S3_ACCESS_KEY_ID and IMAGES_S3_ACCESS_KEY",
      );
    }
  });

  test("explains missing permission", () => {
    expect(hint(s3Error("AccessDenied", 403))).toBe(
      "the access key in IMAGES_S3_ACCESS_KEY_ID doesn't have permission to use the bucket",
    );
    expect(hint(s3Error("Unknown", 403))).toBe(
      "check IMAGES_S3_ACCESS_KEY_ID and IMAGES_S3_ACCESS_KEY, and that the key has permission to use the bucket",
    );
  });

  test("matches the code when the name is generic", () => {
    expect(hint(Object.assign(new Error("x"), { Code: "NoSuchBucket" }))).toBe(
      "check IMAGES_S3_BUCKET_NAME",
    );
  });

  test("gives no hint for unrecognised failures", () => {
    expect(hint(new Error("timed out"))).toBeNull();
    expect(hint(s3Error("InternalError", 500))).toBeNull();
    expect(hint("NoSuchBucket")).toBeNull();
  });

  test("never repeats the error message", () => {
    for (const error of [
      networkError("ENOTFOUND"),
      s3Error("AccessDenied", 403),
      s3Error("SignatureDoesNotMatch", 403),
    ]) {
      expect(hint(error)).not.toContain("secret");
      expect(hint(error)).not.toContain("storage.example.com");
    }
  });
});

describe("runStorageCheck", () => {
  test("prints a hint under the label and rethrows the original error", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const error = s3Error("NoSuchBucket", 404);

    await expect(
      runStorageCheck({
        check: async () => {
          throw error;
        },
        forcePathStyle: false,
        label: "Map storage",
        prefix: "MAP_S3",
      }),
    ).rejects.toBe(error);
    expect(consoleError).toHaveBeenCalledWith("  Map storage: check MAP_S3_BUCKET_NAME");
    consoleError.mockRestore();
  });

  test("prints nothing when the check passes or the failure is unrecognised", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    await runStorageCheck({
      check: async () => ({}),
      forcePathStyle: false,
      label: "Map storage",
      prefix: "MAP_S3",
    });
    await expect(
      runStorageCheck({
        check: async () => {
          throw new Error("timed out");
        },
        forcePathStyle: false,
        label: "Map storage",
        prefix: "MAP_S3",
      }),
    ).rejects.toThrow("timed out");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
