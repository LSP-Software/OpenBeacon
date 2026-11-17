import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { loadDecryptedImage } from "../lib/decryptedImages.ts";
import { cachedImageUri, imageCacheGeneration, imageFileNameFromUrl } from "../lib/imageCache.ts";
import { imageKeySources, imageKeySourcesSignature } from "../lib/imageDecryptor.ts";
import { useAppForeground } from "./useAppForeground.ts";

export const useDecryptedImage = (url: string | null | undefined) => {
  const { data: session } = authClient.useSession();
  const { data: groups } = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    enabled: false,
  });
  const fileName = imageFileNameFromUrl(url);
  const selfId = session?.user.id;
  const selfImage = session?.user.image;
  const selfSealed = session?.user.imageKeySealed;
  const sources = useMemo(
    () =>
      fileName
        ? imageKeySources({
            fileName,
            groups: groups ?? [],
            self: selfId ? { id: selfId, image: selfImage, imageKeySealed: selfSealed } : null,
          })
        : [],
    [fileName, groups, selfId, selfImage, selfSealed],
  );
  const sourcesSignature = imageKeySourcesSignature(sources);
  const generation = imageCacheGeneration();
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation rechecks the file after the image cache is cleared
  const cached = useMemo(
    () => (fileName ? cachedImageUri(fileName) : null),
    [fileName, generation],
  );
  const [loaded, setLoaded] = useState<{
    fileName: string;
    generation: number;
    uri: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const waitingToRetry = useRef(false);

  useAppForeground(() => {
    if (waitingToRetry.current) setRetry((count) => count + 1);
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads a picture that couldn't be fetched or read yet, and the signature stands in for sources so a refetch with the same keys doesn't reload
  useEffect(() => {
    waitingToRetry.current = false;
    if (!url || !fileName || cached) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void tryCatch(loadDecryptedImage({ sources, url })).then((result) => {
      if (!active) return;
      if (result.data?.status === "ready") {
        const uri = result.data.uri;
        setLoaded((previous) =>
          previous?.fileName === fileName &&
          previous.generation === generation &&
          previous.uri === uri
            ? previous
            : { fileName, generation, uri },
        );
        return;
      }
      const retryable =
        result.error ||
        result.data?.status === "unavailable" ||
        result.data?.status === "stale-key";
      if (!retryable) return;
      waitingToRetry.current = true;
      timer = setTimeout(() => setRetry((count) => count + 1), 60_000);
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, fileName, cached, sourcesSignature, generation, retry]);

  if (!fileName) return null;
  if (cached) return cached;
  return loaded?.fileName === fileName && loaded.generation === generation ? loaded.uri : null;
};
