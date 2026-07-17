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

declare class OpenBeaconTrackingModule extends NativeModule {
  provisionEpochKeys(keys: ProvisionedEpochKeyInput[]): void;
  revokeEpochKeys(groupIds?: string[] | null): void;
  listProvisionedEpochKeys(): ProvisionedEpochKeyInfo[];
  startCapture(intervalMs?: number | null): Promise<void>;
  stopCapture(): Promise<void>;
  isCaptureRunning(): boolean;
  listPendingCiphertexts(limit?: number | null): Promise<CiphertextQueueItem[]>;
  markCiphertextsInFlight(ids: number[]): Promise<void>;
  deleteCiphertexts(ids: number[]): Promise<void>;
  requeueCiphertexts(ids: number[], error?: string | null): Promise<void>;
}

export default requireNativeModule<OpenBeaconTrackingModule>("OpenBeaconTracking");
