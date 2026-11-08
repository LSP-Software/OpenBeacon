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
  appliedArchiveKey,
  archiveKey,
}: {
  appliedArchiveKey: string | null;
  archiveKey: string | null;
}) => appliedArchiveKey !== null && archiveKey !== null && appliedArchiveKey !== archiveKey;
