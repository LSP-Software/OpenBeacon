import type { TRACKING_POINT_ROLES } from "@openbeacon/schemas";
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
  role: (typeof TRACKING_POINT_ROLES)[number];
  capturedHour: number | null;
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

export type PlaceGeofenceInput = {
  placeId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type QueuedPlaceTransition = {
  clientId: string;
  senderDeviceId: string;
  groupId: string;
  placeId: string;
  direction: "ARRIVE" | "LEAVE";
  occurredAt: number;
};

export type NoticeKind =
  | "appTooOld"
  | "serverTooOld"
  | "selfHostedServerTooOld"
  | "outOfSync"
  | "deviceRemoved"
  | "signedOut";

export type NoticeSlot = "compatibility" | "locationPermission" | "signedOut" | "sharingChanged";

declare class OpenBeaconTrackingModule extends NativeModule<{
  onSync: (event: { reason: "upload" | "sharing" | "parked" }) => void;
}> {
  setSharingState(
    owner: string,
    deviceId: string,
    revisionPrefix: string,
    paused: boolean,
    pausedUntil: number | null,
    resumeAfter: number | null,
  ): boolean;
  setSeatHoldNotice(owner: string, deviceId: string, sharing: string[], held: string[]): boolean;
  setHistoryShare(
    owner: string,
    deviceId: string,
    account: string,
    groups: Record<string, string>,
  ): boolean;
  isQueueOwner(owner: string, deviceId: string): boolean;
  setQueueOwner(owner: string, deviceId: string): void;
  provisionEpochKeys(keys: ProvisionedEpochKeyInput[], preserveGroupIds?: string[]): void;
  revokeEpochKeys(groupIds?: string[] | null): void;
  listProvisionedEpochKeys(): ProvisionedEpochKeyInfo[];
  pendingPushToken(scope: string): string | null;
  confirmPushToken(scope: string, sent: string | null, pushAvailable: boolean): void;
  forgetPushToken(scope: string): boolean;
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
  shouldShowNotificationRationale(): boolean;
  requestNotificationPermission(): Promise<"granted" | "denied" | "blocked">;
  showNotice(kind: NoticeKind): boolean;
  setRecentsPreviewHidden(hidden: boolean): Promise<void>;
  finishUploadTask(token: string): void;
  elapsedRealtime(): number;
  dismissNotice(slot: NoticeSlot): void;
  setGroupPlaces(
    owner: string,
    deviceId: string,
    groupId: string,
    places: PlaceGeofenceInput[],
  ): Promise<boolean>;
  listPlaceGroups(owner: string, deviceId: string): string[] | null;
  listPlaceTransitions(owner: string): Promise<QueuedPlaceTransition[]>;
  deletePlaceTransitions(clientIds: string[]): Promise<void>;
  showEventNotice(
    kind: "alert" | "placesChanged" | "groupActivity" | "accountAlert",
    key: string,
    title: string,
    body: string | null,
    groupName: string | null,
    link: string,
  ): boolean;
}

export default requireNativeModule<OpenBeaconTrackingModule>("OpenBeaconTracking");
