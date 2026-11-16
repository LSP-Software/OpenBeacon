import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  decryptImage,
  type ImageKeyMaterial,
  MIN_ENCRYPTED_IMAGE_LENGTH,
} from "@openbeacon/encryption";
import { devicePendingCause } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";

const plainImage = new Uint8Array(Array.from({ length: 300 }, (_, index) => (index * 7) % 256));
const files = new Map<string, Uint8Array>();
const cached = {
  get: (path: string) => files.get(path),
  has: (path: string) => files.has(path),
  get size() {
    return [...files.keys()].filter((path) => path.startsWith("cache/images/")).length;
  },
};
let deleted = false;

mock.module("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    path: string;
    constructor(...parts: string[]) {
      this.path = parts.join("/");
    }
    get exists() {
      return [...files.keys()].some((path) => path.startsWith(`${this.path}/`));
    }
    create = () => {};
    delete = () => {
      for (const path of [...files.keys()]) {
        if (path.startsWith(`${this.path}/`)) files.delete(path);
      }
    };
  },
  File: class {
    path: string;
    constructor(...parts: string[]) {
      this.path = parts.join("/");
    }
    get exists() {
      return files.has(this.path);
    }
    get uri() {
      return this.path;
    }
    bytes = async () => files.get(this.path)!.slice();
    create = () => {
      files.set(this.path, new Uint8Array());
    };
    write = (bytes: Uint8Array) => {
      files.set(this.path, bytes.slice());
    };
    move = (destination: { path: string }) => {
      files.set(destination.path, files.get(this.path)!);
      files.delete(this.path);
      this.path = destination.path;
    };
    delete = () => {
      if (this.path === "file://picked") deleted = true;
      files.delete(this.path);
    };
  },
}));
mock.module("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async (_algorithm: string, bytes: Uint8Array) =>
    new Uint8Array(createHash("sha256").update(bytes).digest()).buffer,
}));

const { imageUploadErrorMessage, uploadImageFromUri, uploadToPresignedUrl } =
  await import("./image-upload.ts");
const { GroupKeyUnavailableError, ImageStorageError } = await import("./imageUploadErrors.ts");
const { clearImageCache } = await import("./imageCache.ts");

const trpcError = ({
  cause,
  code,
  httpStatus,
  message = "Server message with internal detail",
  reason,
}: {
  cause?: string;
  code: string;
  httpStatus: number;
  message?: string;
  reason?: string;
}) =>
  TRPCClientError.from({
    error: { code: -32000, data: { cause, code, httpStatus, reason }, message },
  });

const hangingServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data: () => {} },
});
afterAll(() => hangingServer.stop(true));

test("an image upload to storage that never answers gives up at the timeout", async () => {
  const start = performance.now();

  await expect(
    uploadToPresignedUrl(
      `http://127.0.0.1:${hangingServer.port.toString()}/image`,
      new Uint8Array([1, 2, 3]).buffer,
      "BAUG",
      100,
    ),
  ).rejects.toBeInstanceOf(ImageStorageError);
  expect(performance.now() - start).toBeLessThan(2_000);
});

describe("uploadImageFromUri", () => {
  const originalFetch = globalThis.fetch;
  let events: string[] = [];
  let puts: { body: Uint8Array; headers: Record<string, string>; url: string }[] = [];
  let putStatuses: number[] = [];
  let fileNames: string[] = [];
  let confirmed: { fileName: string; imageKey: ImageKeyMaterial }[] = [];
  let confirmFailures: unknown[] = [];
  let onRequest = () => {};

  const request = mock(async () => {
    const fileName = crypto.randomUUID();
    fileNames.push(fileName);
    events.push(`request:${fileName}`);
    onRequest();
    return { fileName };
  });
  const presign = mock(
    async (input: { contentHash: string; fileName: string; fileSize: number }) => {
      events.push(`presign:${input.fileName}`);
      return { presignedUrl: `https://upload.example/${input.fileName}` };
    },
  );
  const confirm = async (input: { fileName: string; imageKey: ImageKeyMaterial }) => {
    events.push(`confirm:${input.fileName}`);
    confirmed.push(input);
    const failure = confirmFailures.shift();
    if (failure) throw failure;
    return { imageUrl: `https://cdn.example/user/user-1/uploads/avatar/${input.fileName}` };
  };

  const upload = () =>
    uploadImageFromUri({
      uri: "file://picked",
      ownerId: "user-1",
      purpose: "profile-image",
      request,
      presign,
      confirm,
    });

  beforeEach(() => {
    events = [];
    puts = [];
    putStatuses = [];
    fileNames = [];
    confirmed = [];
    confirmFailures = [];
    deleted = false;
    files.clear();
    files.set("file://picked", plainImage.slice());
    onRequest = () => {};
    request.mockClear();
    presign.mockClear();
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      const body = new Uint8Array(init.body as ArrayBuffer);
      events.push(`put:${url.split("/").pop() ?? ""}`);
      puts.push({ body, headers: init.headers as Record<string, string>, url });
      return new Response(null, { status: putStatuses.shift() ?? 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("encrypts the picture for its file name before uploading it", async () => {
    expect(await upload()).toEqual({
      data: `https://cdn.example/user/user-1/uploads/avatar/${fileNames[0]}`,
    });
    const [put] = puts;
    const [{ fileName, imageKey }] = confirmed as [(typeof confirmed)[number]];
    expect(fileName).toBe(fileNames[0]!);
    expect(put!.body).not.toEqual(plainImage);
    expect(
      decryptImage({
        blob: put!.body,
        fileName,
        key: imageKey,
        ownerId: "user-1",
        purpose: "profile-image",
      }),
    ).toEqual(plainImage);
    expect(() =>
      decryptImage({
        blob: put!.body,
        fileName: crypto.randomUUID(),
        key: imageKey,
        ownerId: "user-1",
        purpose: "profile-image",
      }),
    ).toThrow();
  });

  test("never sends the plain picture to storage", async () => {
    await upload();
    const body = Buffer.from(puts[0]!.body);
    expect(body.includes(Buffer.from(plainImage.subarray(0, 32)))).toBe(false);
    expect(puts[0]!.headers["Content-Type"]).toBe("application/octet-stream");
  });

  test("presigns with the encrypted file's size and hash", async () => {
    await upload();
    const body = puts[0]!.body;
    const hash = createHash("sha256").update(body).digest("base64");
    expect(body.byteLength).toBe(plainImage.byteLength + MIN_ENCRYPTED_IMAGE_LENGTH);
    expect(presign).toHaveBeenCalledWith({
      contentHash: hash,
      fileName: fileNames[0]!,
      fileSize: body.byteLength,
    });
    expect(puts[0]!.headers["x-amz-checksum-sha256"]).toBe(hash);
  });

  test("asks for the file name, presigns, uploads and only then confirms", async () => {
    await upload();
    const fileName = fileNames[0]!;
    expect(events).toEqual([
      `request:${fileName}`,
      `presign:${fileName}`,
      `put:${fileName}`,
      `confirm:${fileName}`,
    ]);
  });

  test("keeps the plain picture in this phone's cache under its file name", async () => {
    await upload();
    expect(cached.get(`cache/images/${fileNames[0]}`)).toEqual(plainImage);
    expect(deleted).toBe(true);
  });

  test("doesn't cache the plain picture when the phone signs out during the upload", async () => {
    onRequest = clearImageCache;
    expect((await upload()).data).toBeString();
    expect(cached.size).toBe(0);
  });

  test("leaves no partly written file in the cache", async () => {
    await upload();
    expect([...files.keys()]).toEqual([`cache/images/${fileNames[0]}`]);
  });

  test("makes a fresh key for every upload", async () => {
    await upload();
    files.set("file://picked", plainImage.slice());
    await upload();
    expect(confirmed[0]!.imageKey.expose()).not.toEqual(confirmed[1]!.imageKey.expose());
  });

  test("retries a failed upload to storage once without asking the user", async () => {
    putStatuses = [500];
    expect((await upload()).data).toBeString();
    expect(puts).toHaveLength(2);
    expect(puts[1]!.body).toEqual(puts[0]!.body);
  });

  test("doesn't confirm or cache when storage keeps refusing the upload", async () => {
    putStatuses = [403, 403];
    expect(await upload()).toEqual({
      error: "Unable to upload image. Check your connection and try again.",
    });
    expect(confirmed).toHaveLength(0);
    expect(cached.size).toBe(0);
    expect(deleted).toBe(true);
  });

  test("starts again with a new file name when the pending upload was replaced", async () => {
    confirmFailures = [trpcError({ code: "PRECONDITION_FAILED", httpStatus: 412 })];
    const result = await upload();
    expect(fileNames).toHaveLength(2);
    expect(result).toEqual({
      data: `https://cdn.example/user/user-1/uploads/avatar/${fileNames[1]}`,
    });
    expect(cached.has(`cache/images/${fileNames[0]}`)).toBe(false);
    expect(cached.has(`cache/images/${fileNames[1]}`)).toBe(true);
  });

  test("asks for the picture again when the pending upload keeps going missing", async () => {
    confirmFailures = [
      trpcError({ code: "PRECONDITION_FAILED", httpStatus: 412 }),
      trpcError({ code: "PRECONDITION_FAILED", httpStatus: 412 }),
    ];
    expect(await upload()).toEqual({
      error: "That upload expired. Please choose the image again.",
    });
    expect(cached.size).toBe(0);
  });

  test("doesn't cache a picture whose confirm failed", async () => {
    confirmFailures = [new GroupKeyUnavailableError()];
    expect(await upload()).toEqual({
      error: "This phone can’t use this group’s key yet. Try again in a minute.",
    });
    expect(cached.size).toBe(0);
  });
});

describe("imageUploadErrorMessage", () => {
  test.each([
    [
      trpcError({ code: "FORBIDDEN", httpStatus: 403, reason: "DEVICE_NOT_REGISTERED" }),
      "This phone is still being set up. Try again in a minute.",
    ],
    [
      trpcError({ code: "CONFLICT", httpStatus: 409, reason: "EPOCH_NOT_LATEST" }),
      "This group’s keys are being updated. Try again in a minute.",
    ],
    [
      trpcError({ code: "CONFLICT", httpStatus: 409, reason: "EPOCH_ROTATION_PENDING" }),
      "This group’s keys are being updated. Try again in a minute.",
    ],
    [
      trpcError({ code: "CONFLICT", httpStatus: 409, reason: "IMAGE_CHANGED" }),
      "Your picture was changed on another phone. Try again.",
    ],
    [
      trpcError({ code: "PRECONDITION_FAILED", httpStatus: 412 }),
      "That upload expired. Please choose the image again.",
    ],
    [
      trpcError({ code: "BAD_REQUEST", httpStatus: 400, message: "Uploaded failed verification." }),
      "That image couldn’t be uploaded. Try a different one.",
    ],
    [
      trpcError({ code: "INTERNAL_SERVER_ERROR", httpStatus: 500 }),
      "Unable to upload image. Check your connection and try again.",
    ],
    [new ImageStorageError(403), "Unable to upload image. Check your connection and try again."],
    [new ImageStorageError(null), "Unable to upload image. Check your connection and try again."],
  ])("%#: maps to a plain message", (error, message) => {
    expect(imageUploadErrorMessage(error)).toBe(message);
  });

  test("keeps the server's own wording for a phone that isn't set up yet", () => {
    expect(
      imageUploadErrorMessage(
        trpcError({
          cause: devicePendingCause,
          code: "FORBIDDEN",
          httpStatus: 403,
          message: "Finish setting up this phone first.",
        }),
      ),
    ).toBe("Finish setting up this phone first.");
  });
});
