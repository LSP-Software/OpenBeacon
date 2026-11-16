import {
  decryptImage,
  decryptImageKey,
  type EpochKeyMaterial,
  type ImageKeyMaterial,
} from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import type { RouterOutputs } from "./api.ts";
import { imageFileNameFromUrl } from "./imageCache.ts";

type StoredImageKey = NonNullable<RouterOutputs["groupMembership"]["list"][number]["imageKey"]>;

export type ImageKeySource =
  | { kind: "own"; sealed: string | null; userId: string }
  | { kind: "group"; groupId: string; imageKey: StoredImageKey }
  | { kind: "member"; groupId: string; imageKey: StoredImageKey; userId: string };

export type DecryptedImageResult =
  | { status: "ready"; uri: string }
  | { status: "no-picture" }
  | { status: "no-key" }
  | { status: "stale-key" }
  | { status: "undecryptable" }
  | { status: "unavailable" };

const RETRY_AFTER_MS = 60_000;

export const imageKeySources = ({
  fileName,
  groups,
  self,
}: {
  fileName: string;
  groups: readonly {
    id: string;
    image: string | null;
    imageKey: StoredImageKey | null;
    members: readonly { image: string | null; imageKey: StoredImageKey | null; userId: string }[];
  }[];
  self: {
    id: string;
    image?: string | null | undefined;
    imageKeySealed?: string | null | undefined;
  } | null;
}) => {
  const sources: ImageKeySource[] = [];
  if (self && imageFileNameFromUrl(self.image) === fileName) {
    sources.push({ kind: "own", sealed: self.imageKeySealed ?? null, userId: self.id });
  }
  for (const group of groups) {
    if (group.imageKey && imageFileNameFromUrl(group.image) === fileName) {
      sources.push({ kind: "group", groupId: group.id, imageKey: group.imageKey });
    }
    for (const member of group.members) {
      if (member.imageKey && imageFileNameFromUrl(member.image) === fileName) {
        sources.push({
          kind: "member",
          groupId: group.id,
          imageKey: member.imageKey,
          userId: member.userId,
        });
      }
    }
  }
  return sources;
};

const imageKeySourcesSignature = (sources: readonly ImageKeySource[]) =>
  sources
    .map((source) =>
      source.kind === "own"
        ? `own:${source.userId}:${source.sealed ?? ""}`
        : `${source.kind}:${source.groupId}:${source.imageKey.epochId}:${source.imageKey.ciphertext}`,
    )
    .join("|");

export const createImageDecryptor = (deps: {
  cachedUri: (fileName: string) => string | null;
  download: (url: string) => Promise<Uint8Array>;
  generation: () => number;
  getOwnImageKey: (input: {
    fileName: string;
    sealed: string | null;
    userId: string;
  }) => Promise<ImageKeyMaterial | null>;
  now: () => number;
  resolveEpochKey: (input: {
    epochId: string;
    groupId: string;
  }) => Promise<EpochKeyMaterial | null>;
  writeCached: (input: {
    bytes: Uint8Array;
    fileName: string;
    forGeneration: number;
  }) => string | null;
}) => {
  const attempts = new Map<string, { at: number; result: Promise<DecryptedImageResult> }>();
  let attemptsGeneration = deps.generation();

  const unwrapKey = async ({
    fileName,
    source,
  }: {
    fileName: string;
    source: ImageKeySource;
  }): Promise<
    { key: ImageKeyMaterial } | { status: "no-key" | "stale-key" | "undecryptable" | "unavailable" }
  > => {
    if (source.kind === "own") {
      const own = await tryCatch(
        deps.getOwnImageKey({ fileName, sealed: source.sealed, userId: source.userId }),
      );
      if (own.error) return { status: "unavailable" };
      return own.data ? { key: own.data } : { status: "no-key" };
    }
    const epochKey = await tryCatch(
      deps.resolveEpochKey({ epochId: source.imageKey.epochId, groupId: source.groupId }),
    );
    if (epochKey.error) return { status: "unavailable" };
    const resolvedEpochKey = epochKey.data;
    if (!resolvedEpochKey) return { status: "stale-key" };
    const unwrapped = await tryCatch(
      Promise.resolve().then(() =>
        decryptImageKey({
          encryptedKey: source.imageKey,
          epochKey: resolvedEpochKey,
          fileName,
          groupId: source.groupId,
          kind: source.kind === "group" ? "group-image-key" : "profile-image-key",
          ownerId: source.kind === "group" ? source.groupId : source.userId,
        }),
      ),
    );
    return unwrapped.error ? { status: "undecryptable" } : { key: unwrapped.data };
  };

  const decrypt = async ({
    fileName,
    forGeneration,
    sources,
    url,
  }: {
    fileName: string;
    forGeneration: number;
    sources: readonly ImageKeySource[];
    url: string;
  }): Promise<DecryptedImageResult> => {
    const failures = new Set<DecryptedImageResult["status"]>();
    let blob: Promise<Uint8Array> | null = null;
    for (const source of sources) {
      const unwrapped = await unwrapKey({ fileName, source });
      if ("status" in unwrapped) {
        failures.add(unwrapped.status);
        continue;
      }
      blob ??= deps.download(url);
      const downloaded = await tryCatch(blob);
      if (downloaded.error) return { status: "unavailable" };
      const plain = await tryCatch(
        Promise.resolve().then(() =>
          decryptImage({
            blob: downloaded.data,
            fileName,
            key: unwrapped.key,
            ownerId: source.kind === "group" ? source.groupId : source.userId,
            purpose: source.kind === "group" ? "group-image" : "profile-image",
          }),
        ),
      );
      if (plain.error) {
        failures.add("undecryptable");
        continue;
      }
      const written = await tryCatch(
        Promise.resolve().then(() =>
          deps.writeCached({ bytes: plain.data, fileName, forGeneration }),
        ),
      );
      if (written.error || !written.data) return { status: "unavailable" };
      return { status: "ready", uri: written.data };
    }
    for (const status of ["unavailable", "undecryptable", "stale-key"] as const) {
      if (failures.has(status)) return { status };
    }
    return { status: "no-key" };
  };

  const load = async ({
    sources,
    url,
  }: {
    sources: readonly ImageKeySource[];
    url: string | null | undefined;
  }): Promise<DecryptedImageResult> => {
    const fileName = imageFileNameFromUrl(url);
    if (!url || !fileName) return { status: "no-picture" };
    const cached = await tryCatch(Promise.resolve().then(() => deps.cachedUri(fileName)));
    if (cached.data) return { status: "ready", uri: cached.data };
    const forGeneration = deps.generation();
    if (forGeneration !== attemptsGeneration) {
      attempts.clear();
      attemptsGeneration = forGeneration;
    }
    const attemptKey = `${fileName}|${imageKeySourcesSignature(sources)}`;
    const previous = attempts.get(attemptKey);
    if (previous) {
      const result = await previous.result;
      const retryable = result.status === "unavailable" || result.status === "stale-key";
      if (!retryable || deps.now() - previous.at < RETRY_AFTER_MS) return result;
    }
    const result = decrypt({ fileName, forGeneration, sources, url }).then((settled) => {
      if (settled.status === "ready") attempts.delete(attemptKey);
      return settled;
    });
    attempts.set(attemptKey, { at: deps.now(), result });
    return result;
  };

  return { load };
};
