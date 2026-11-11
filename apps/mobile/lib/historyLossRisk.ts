export const historyLossRisk = ({
  devices,
  heldVersions,
  recoveryStatus,
  thisDeviceId,
}: {
  devices: readonly { activatedAt: Date | null; id: string; isCurrent: boolean }[] | undefined;
  heldVersions: readonly number[] | undefined;
  recoveryStatus:
    { currentHistoryKey: { version: number } | null; recoveryKey: object | null } | undefined;
  thisDeviceId: string | undefined;
}): "none" | "possible" | "certain" => {
  if (recoveryStatus?.recoveryKey) return "none";
  if (recoveryStatus && !recoveryStatus.currentHistoryKey) return "none";
  const currentVersion = recoveryStatus?.currentHistoryKey?.version;
  if (heldVersions && currentVersion !== undefined && !heldVersions.includes(currentVersion)) {
    return "none";
  }
  const identified =
    devices?.some((device) => device.isCurrent || device.id === thisDeviceId) === true;
  const otherActivePhones =
    devices?.filter(
      (device) => device.activatedAt && !device.isCurrent && device.id !== thisDeviceId,
    ).length ?? 0;
  if (otherActivePhones >= (identified ? 1 : 2)) return "none";
  return recoveryStatus && heldVersions && devices && identified ? "certain" : "possible";
};
