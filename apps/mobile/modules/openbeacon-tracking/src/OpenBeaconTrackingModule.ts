import { NativeModule, requireNativeModule } from "expo";

export type ProvisionedEpochKeyInput = {
  groupId: string;
  epochId: string;
  epochKeyBase64: string;
  senderDeviceId: string;
  kind?: string;
};

export type ProvisionedEpochKeyInfo = {
  groupId: string;
  epochId: string;
  senderDeviceId: string;
  kind: string;
};

export type CiphertextQueueItem = {
  id: number;
  clientPointId: string;
  captureId: string;
  groupId: string;
  epochId: string;
  senderDeviceId: string;
  kind: string;
  algorithm: string;
  nonce: string;
  ciphertext: string;
  queuedAt: number;
  attemptCount: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  status: "PENDING" | "IN_FLIGHT";
};

export type CiphertextQueueEviction = {
  pointCount: number;
  oldestQueuedAt: number;
  newestQueuedAt: number;
  revision: number;
};

export type NoticeKind =
  | "appTooOld"
  | "serverTooOld"
  | "selfHostedServerTooOld"
  | "outOfSync"
  | "deviceRemoved"
  | "signedOut";

export type NoticeSlot = "compatibility" | "locationPermission" | "signedOut" | "sharingChanged";

declare class OpenBeaconTrackingModule extends NativeModule {
  setSharingState(
    owner: string,
    deviceId: string,
    revisionPrefix: string,
    paused: boolean,
    pausedUntil: number | null,
    resumeAfter: number | null,
  ): boolean;
  setQueueOwner(owner: string, deviceId: string): void;
  provisionEpochKeys(keys: ProvisionedEpochKeyInput[], preserveGroupIds?: string[]): void;
  revokeEpochKeys(groupIds?: string[] | null): void;
  listProvisionedEpochKeys(): ProvisionedEpochKeyInfo[];
  startCapture(intervalMs?: number | null): Promise<void>;
  refreshCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  isCaptureRunning(): boolean;
  countUnassignedCiphertexts(senderDeviceId: string): Promise<number>;
  assignUnassignedCiphertexts(senderDeviceId: string, owner: string): Promise<void>;
  listPendingCiphertexts(
    owner: string,
    limit?: number | null,
    afterId?: number | null,
  ): Promise<CiphertextQueueItem[]>;
  markCiphertextsInFlight(ids: number[]): Promise<number[]>;
  getCiphertextEviction(owner: string): Promise<CiphertextQueueEviction | null>;
  acknowledgeCiphertextEviction(owner: string, revision: number): Promise<void>;
  deleteCiphertexts(ids: number[]): Promise<void>;
  deleteCiphertextsByOwner(owner: string): Promise<void>;
  deleteCiphertextsByGroup(owner: string, groupId: string): Promise<void>;
  requeueCiphertexts(ids: number[], error?: string | null): Promise<void>;
  areNotificationsEnabled(): boolean;
  showNotice(kind: NoticeKind): boolean;
  dismissNotice(slot: NoticeSlot): void;
}

export default requireNativeModule<OpenBeaconTrackingModule>("OpenBeaconTracking");
