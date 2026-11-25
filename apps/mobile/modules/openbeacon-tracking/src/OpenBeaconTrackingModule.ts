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
  sharesTransitions: boolean;
};

export type QueuedPlaceTransition = {
  clientId: string;
  senderDeviceId: string;
  groupId: string;
  placeId: string;
  direction: "ARRIVE" | "LEAVE";
  occurredAt: number;
};

export type QueuedDrive = {
  id: number;
  groupId: string;
  driveId: string;
  epochId: string;
  senderDeviceId: string;
  startHour: number;
  nonce: string;
  ciphertext: string;
};

export type PlaceSearchAddress = {
  addressLine: string | null;
  houseNumber: string | null;
  street: string | null;
  subLocality: string | null;
  locality: string | null;
  postcode: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  name?: string | null;
};

export type PlaceSearchBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type PlaceSearchOutcome =
  | { status: "results"; results: PlaceSearchAddress[] }
  | { status: "unavailable" }
  | { status: "error"; message: string };

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
  pushStatus(scope: string): {
    builtIn: boolean;
    serverPush: boolean | null;
    registration: "noToken" | "notSent" | "registered";
    lastWakeAt: number | null;
    lastWakeKind: "sync" | "locate" | null;
  };
  forgetPushToken(scope: string | null): boolean;
  startCapture(intervalMs?: number | null): Promise<void>;
  refreshCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  isCaptureRunning(): boolean;
  isLowPowerMode(): boolean;
  setLowPowerMode(enabled: boolean): void;
  isDriveDetectionOn(): boolean;
  setDriveDetection(on: boolean): void;
  isCrashAlertsOn(): boolean;
  setCrashAlerts(on: boolean): void;
  setCrashAlertContext(groups: Record<string, string>, speedUnit: "mph" | "kmh"): void;
  startCrashTest(): void;
  listDriveIds(owner: string): Promise<string[]>;
  deleteDrives(owner: string, driveIds: string[]): Promise<void>;
  isDriveRecording(): boolean;
  speedLimitPacks(): Promise<{
    currentRegion: string | null;
    packs: {
      regionId: string;
      build: string;
      sha256: string;
      size: number;
      lastInAt: number;
    }[];
  }>;
  noteSpeedLimitRegion(regionId: string): Promise<void>;
  downloadSpeedLimitPack(request: {
    regionId: string;
    build: string;
    url: string;
    size: number;
    sha256: string;
  }): void;
  deleteSpeedLimitPacks(): Promise<void>;
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
  listQueuedDrives(owner: string): Promise<QueuedDrive[]>;
  deleteQueuedDrives(ids: number[]): Promise<void>;
  showEventNotice(
    kind: "alert" | "placesChanged" | "groupActivity" | "accountAlert",
    key: string,
    title: string,
    body: string | null,
    groupName: string | null,
    link: string,
  ): boolean;
  clearEventNotices(keepSecurityAlerts: boolean): Promise<void>;
  isPlaceSearchAvailable(): boolean;
  searchPlaces(query: string, box: PlaceSearchBox | null): Promise<PlaceSearchOutcome>;
}

export default requireNativeModule<OpenBeaconTrackingModule>("OpenBeaconTracking");
