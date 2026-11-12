import type { SharingPreference } from "./locationSharingTypes.ts";

export const isSharingPaused = (preference: SharingPreference, now = Date.now()) =>
  preference.sharingPaused &&
  (preference.sharingPausedUntil === null || preference.sharingPausedUntil.getTime() > now);

export const resolveLocationSharing = (
  account: SharingPreference,
  device: SharingPreference,
  now = Date.now(),
) => {
  const active = [account, device].filter((preference) => isSharingPaused(preference, now));
  const deadlines = active.flatMap((preference) =>
    preference.sharingPausedUntil ? [preference.sharingPausedUntil.getTime()] : [],
  );
  const cutoffs = [account, device].flatMap((preference) => {
    if (preference.sharingRevision === 0) return [];
    return [
      preference.sharingChangedAt?.getTime() ?? 0,
      ...(preference.sharingPaused && preference.sharingPausedUntil
        ? [preference.sharingPausedUntil.getTime()]
        : []),
    ];
  });
  return {
    paused: active.length > 0,
    pausedUntil:
      active.length > 0 && deadlines.length === active.length
        ? new Date(Math.max(...deadlines))
        : null,
    resumeAfter: cutoffs.length > 0 ? new Date(Math.max(...cutoffs)) : null,
    revisionPrefix:
      account.sharingRevision === 0 && device.sharingRevision === 0
        ? ""
        : `s${account.sharingRevision}.${device.sharingRevision}:`,
  };
};
