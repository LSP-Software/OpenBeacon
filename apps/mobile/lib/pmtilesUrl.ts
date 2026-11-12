export const getPmtilesUrlRefreshDelayMs = ({
  now = Date.now,
  refreshAt,
}: {
  now?: () => number;
  refreshAt: string;
}) => {
  const refreshAtTimestamp = new Date(refreshAt).getTime();

  if (Number.isNaN(refreshAtTimestamp)) {
    return 0;
  }

  return Math.max(refreshAtTimestamp - now(), 0);
};

export const hasPmtilesArchiveChanged = ({
  appliedArchiveId,
  archiveId,
}: {
  appliedArchiveId: string | null;
  archiveId: string | null;
}) => appliedArchiveId !== null && archiveId !== null && appliedArchiveId !== archiveId;

export const getPmtilesSource = ({
  archiveId,
  signedUrl,
}: {
  archiveId: string | null;
  signedUrl: string;
}) => {
  const unsignedUrl = signedUrl.split("?")[0] ?? "";
  const sourceUrl = archiveId
    ? `${unsignedUrl}?archive=${encodeURIComponent(archiveId)}`
    : unsignedUrl;

  return {
    find: `^${sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${archiveId ? "$" : "(?:\\?.*)?$"}`,
    sourceUrl,
  };
};

export const formatMapVersion = ({
  archiveId,
  mapBuild,
}: {
  archiveId: string;
  mapBuild: string | null;
}) =>
  mapBuild ? `${mapBuild.slice(0, 4)}-${mapBuild.slice(4, 6)}-${mapBuild.slice(6, 8)}` : archiveId;
