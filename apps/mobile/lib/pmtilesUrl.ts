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
