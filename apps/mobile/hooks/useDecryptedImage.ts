import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/api.ts";
import { authClient } from "../lib/auth-client.ts";
import { loadDecryptedImage } from "../lib/decryptedImages.ts";
import { cachedImageUri, imageFileNameFromUrl } from "../lib/imageCache.ts";
import { imageKeySources } from "../lib/imageDecryptor.ts";

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
  const cached = useMemo(() => (fileName ? cachedImageUri(fileName) : null), [fileName]);
  const [loaded, setLoaded] = useState<{ fileName: string; uri: string } | null>(null);

  useEffect(() => {
    if (!url || !fileName || cached) return;
    let active = true;
    void tryCatch(loadDecryptedImage({ sources, url })).then((result) => {
      if (!active || result.data?.status !== "ready") return;
      setLoaded({ fileName, uri: result.data.uri });
    });
    return () => {
      active = false;
    };
  }, [url, fileName, cached, sources]);

  if (!fileName) return null;
  return cached ?? (loaded?.fileName === fileName ? loaded.uri : null);
};
