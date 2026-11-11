import { beforeEach, describe, expect, mock, test } from "bun:test";
import { devicePendingCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

let deleted = false;
mock.module("expo-file-system", () => ({
  File: class {
    exists = true;
    bytes = async () => new Uint8Array([1, 2, 3]);
    delete = () => {
      deleted = true;
    };
  },
}));
mock.module("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async () => new Uint8Array([4, 5, 6]).buffer,
}));

const { uploadImageFromUri } = await import("./image-upload.ts");

describe("uploadImageFromUri", () => {
  beforeEach(() => {
    deleted = false;
  });

  test("requests, uploads and confirms the image before returning its URL", async () => {
    const request = mock(async (_input: { fileSize: number; contentHash: string }) => ({
      presignedUrl: "https://upload.example/image",
    }));
    const confirm = mock(async () => ({ imageUrl: "https://cdn.example/image" }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    try {
      expect(
        await uploadImageFromUri({
          uri: "file://image",
          requestImageUpload: request,
          confirmImageUpload: confirm,
        }),
      ).toEqual({ data: "https://cdn.example/image" });
      expect(request).toHaveBeenCalledWith({ fileSize: 3, contentHash: "BAUG" });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(deleted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not confirm a failed upload and cleans up the temporary image", async () => {
    const confirm = mock(async () => ({ imageUrl: "https://cdn.example/image" }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response(null, { status: 403 }),
    ) as unknown as typeof fetch;
    try {
      expect(
        await uploadImageFromUri({
          uri: "file://image",
          requestImageUpload: async () => ({ presignedUrl: "https://upload.example/image" }),
          confirmImageUpload: confirm,
        }),
      ).toEqual({ error: "Unable to upload image. Check your connection and try again." });
      expect(confirm).not.toHaveBeenCalled();
      expect(deleted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows the server's reason when it refuses the upload", async () => {
    const confirm = mock(async () => ({ imageUrl: "https://cdn.example/image" }));
    expect(
      await uploadImageFromUri({
        uri: "file://image",
        requestImageUpload: async () => {
          throw TRPCClientError.from({
            error: {
              code: -32003,
              data: { cause: devicePendingCause, code: "FORBIDDEN", httpStatus: 403 },
              message: "Finish setting up this phone first.",
            },
          });
        },
        confirmImageUpload: confirm,
      }),
    ).toEqual({ error: "Finish setting up this phone first." });
    expect(confirm).not.toHaveBeenCalled();
    expect(deleted).toBe(true);
  });
});
