import type { LiveMapEntry } from "./liveMapReducer.ts";
import type { DeviceSharingState } from "@openbeacon/shared";

export type MapTrackingEncryptedPoint = {
  algorithm: string;
  ciphertext: string;
  clientPointId: string;
  createdAt: Date;
  epochId: string;
  id: string;
  kind: string;
  nonce: string;
  senderDeviceId: string;
  senderUserId: string;
};

export type MapTrackingCursor = {
  createdAt: Date;
  id: string;
};

export type LiveMapPosition = Omit<LiveMapEntry, "serverCreatedAt" | "serverId">;

export type MapTrackingDeps = {
  clearEpochKeys: (groupId?: string) => void;
  decryptPoint: (input: {
    groupId: string;
    point: MapTrackingEncryptedPoint;
  }) => Promise<
    { entry: LiveMapEntry; status: "ok" } | { status: "ignored" } | { status: "undecryptable" }
  >;
  getLatest: (
    groupId: string,
    signal: AbortSignal,
  ) => Promise<{ points: MapTrackingEncryptedPoint[]; sharing?: DeviceSharingState[] }>;
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
    sharing?: DeviceSharingState[];
    cursor?: MapTrackingCursor | null;
  }>;
  schedule: (callback: () => void, delayMs: number) => { cancel: () => void };
};

export type MapTrackingStatus = {
  sharing?: readonly DeviceSharingState[];
  connection: "ok" | "failing";
  groups: Readonly<Record<string, "loaded" | "failed">>;
  membership: "loading" | "loaded" | "failed";
  undecryptable: readonly { deviceId: string; groupId: string; userId: string }[];
};
