import type { LiveMapEntry } from "./liveMapReducer.ts";
import type { GroupDeviceSharingState } from "@openbeacon/shared";

export type MapTrackingEncryptedPoint = {
  ciphertext: string;
  epochId: string;
  nonce: string;
  revisionPrefix: string;
  senderDeviceId: string;
  senderUserId: string;
  updatedAt: Date;
};

export type MapTrackingCursor = {
  senderDeviceId: string;
  updatedAt: Date;
};

export type LiveMapPosition = Omit<LiveMapEntry, "serverUpdatedAt">;

export type MapTrackingDeps = {
  clearEpochKeys: (groupId?: string) => void;
  decryptPoint: (input: {
    groupId: string;
    point: MapTrackingEncryptedPoint;
  }) => Promise<{ entry: LiveMapEntry; status: "ok" } | { status: "undecryptable" }>;
  getLatest: (
    groupId: string,
    signal: AbortSignal,
  ) => Promise<{ points: MapTrackingEncryptedPoint[]; sharing?: GroupDeviceSharingState[] }>;
  listGroups: (signal: AbortSignal) => Promise<Array<{ id: string }>>;
  now: () => number;
  poll: (
    input: {
      cursor: MapTrackingCursor | null;
      groupId: string;
      limit: number;
    },
    signal: AbortSignal,
  ) => Promise<{
    points: MapTrackingEncryptedPoint[];
    sharing?: GroupDeviceSharingState[];
    cursor?: MapTrackingCursor | null;
    hasMore?: boolean;
  }>;
  schedule: (callback: () => void, delayMs: number) => { cancel: () => void };
};

export type MapTrackingStatus = {
  sharing?: readonly GroupDeviceSharingState[];
  connection: "ok" | "failing";
  groups: Readonly<Record<string, "loaded" | "failed">>;
  membership: "loading" | "loaded" | "failed";
  undecryptable: readonly { deviceId: string; groupId: string; userId: string }[];
};
