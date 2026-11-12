export type SharingPreference = {
  sharingPaused: boolean;
  sharingPausedUntil: Date | null;
  sharingChangedAt: Date | null;
  sharingRevision: number;
};

export type DeviceSharingState = {
  deviceId: string;
  userId: string;
  paused: boolean;
  pausedUntil: Date | null;
  resumeAfter: Date | null;
  revisionPrefix: string;
};

export type GroupDeviceSharingState = Pick<
  DeviceSharingState,
  "deviceId" | "userId" | "paused" | "revisionPrefix"
>;
