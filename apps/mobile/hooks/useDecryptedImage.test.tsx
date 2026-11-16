import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";
import type { DecryptedImageResult } from "../lib/imageDecryptor.ts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const fileName = "0d6c8c2e-2b1a-4c55-9a4e-6f1b2f3c4d5e";
const url = `https://cdn.example/images/profile/${fileName}`;
const session = { data: null };
const appStateListeners = new Set<(state: string) => void>();
const cachedFiles = new Set<string>();
let cacheGeneration = 0;
let nextResult: DecryptedImageResult = { status: "unavailable" };
const loadDecryptedImage = mock(async () => nextResult);

mock.module("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  },
}));
const groupsQuery = { data: [] };
mock.module("@tanstack/react-query", () => ({ useQuery: () => groupsQuery }));
mock.module("../lib/api.ts", () => ({
  trpc: { groupMembership: { list: { queryOptions: () => ({}) } } },
}));
mock.module("../lib/auth-client.ts", () => ({
  authClient: { useSession: () => session },
}));
mock.module("../lib/decryptedImages.ts", () => ({ loadDecryptedImage }));
mock.module("../lib/imageCache.ts", () => ({
  cachedImageUri: (name: string) => (cachedFiles.has(name) ? `file:///cache/${name}` : null),
  imageCacheGeneration: () => cacheGeneration,
  imageFileNameFromUrl: (value: string | null | undefined) => value?.split("/").pop() ?? null,
}));

const { useDecryptedImage } = await import("./useDecryptedImage.ts");

let shown: string | null = null;
let root: Root | null = null;

const Avatar = () => {
  shown = useDecryptedImage(url);
  return null;
};

const render = async () => {
  root ??= createRoot();
  await act(async () => root?.render(<Avatar />));
};

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const comeBackToForeground = () =>
  act(async () => {
    for (const listener of appStateListeners) listener("background");
    for (const listener of appStateListeners) listener("active");
  });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  shown = null;
  jest.useRealTimers();
  loadDecryptedImage.mockClear();
  cachedFiles.clear();
  cacheGeneration = 0;
  nextResult = { status: "unavailable" };
});

test("a picture that couldn't be fetched is tried again a minute later", async () => {
  await render();
  expect(loadDecryptedImage).toHaveBeenCalledTimes(1);

  await advance(59_999);
  expect(loadDecryptedImage).toHaveBeenCalledTimes(1);

  nextResult = { status: "ready", uri: `file:///cache/${fileName}` };
  await advance(1);

  expect(loadDecryptedImage).toHaveBeenCalledTimes(2);
  expect(shown).toBe(`file:///cache/${fileName}`);
  await advance(10 * 60_000);
  expect(loadDecryptedImage).toHaveBeenCalledTimes(2);
});

test("a key that can't be read yet is tried again a minute later", async () => {
  nextResult = { status: "stale-key" };
  await render();

  await advance(60_000);

  expect(loadDecryptedImage).toHaveBeenCalledTimes(2);
});

test("a picture that can't be decrypted isn't tried again", async () => {
  nextResult = { status: "undecryptable" };
  await render();

  await advance(10 * 60_000);
  await comeBackToForeground();

  expect(loadDecryptedImage).toHaveBeenCalledTimes(1);
});

test("coming back to the app retries a picture that is waiting to retry", async () => {
  await render();

  await comeBackToForeground();

  expect(loadDecryptedImage).toHaveBeenCalledTimes(2);
});

test("unmounting cancels the retry", async () => {
  await render();
  await act(async () => root?.unmount());
  root = null;

  await advance(10 * 60_000);

  expect(loadDecryptedImage).toHaveBeenCalledTimes(1);
});

test("a cached picture is dropped once the image cache is cleared", async () => {
  cachedFiles.add(fileName);
  await render();
  expect(shown).toBe(`file:///cache/${fileName}`);

  cachedFiles.clear();
  cacheGeneration += 1;
  await render();

  expect(shown).toBeNull();
  expect(loadDecryptedImage).toHaveBeenCalledTimes(1);
});
