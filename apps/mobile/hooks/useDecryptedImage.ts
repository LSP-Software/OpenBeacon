import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { loadDecryptedImage } from "../lib/decryptedImages.ts";
import { cachedImageUri, imageCacheGeneration, imageFileNameFromUrl } from "../lib/imageCache.ts";
import { imageKeySources } from "../lib/imageDecryptor.ts";
import { useAppForeground } from "./useAppForeground.ts";

export const useDecryptedImage = (url: string | null | undefined) => {
  const { data: session } = authClient.useSession();
  const { data: groups } = useQuery({
    ...trpc.groupMembership.list.queryOptions(),
    enabled: false,
  });
  const fileName = imageFileNameFromUrl(url);
  const self = session?.user ?? null;
  const sources = useMemo(
    () => (fileName ? imageKeySources({ fileName, groups: groups ?? [], self }) : []),
    [fileName, groups, self],
  );
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry reloads a picture that couldn't be fetched or read yet
  useEffect(() => {
    waitingToRetry.current = false;
    if (!url || !fileName || cached) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void tryCatch(loadDecryptedImage({ sources, url })).then((result) => {
      if (!active) return;
      if (result.data?.status === "ready") {
        setLoaded({ fileName, generation, uri: result.data.uri });
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
  }, [url, fileName, cached, sources, generation, retry]);

  if (!fileName) return null;
  if (cached) return cached;
  return loaded?.fileName === fileName && loaded.generation === generation ? loaded.uri : null;
};
