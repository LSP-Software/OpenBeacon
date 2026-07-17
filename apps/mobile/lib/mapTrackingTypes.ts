import type { LiveMapEntry } from "./liveMapReducer.ts";

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
  decryptPoint: (input: {
    groupId: string;
    point: MapTrackingEncryptedPoint;
  }) => Promise<
    { entry: LiveMapEntry; status: "ok" } | { status: "ignored" } | { status: "undecryptable" }
  >;
  getLatest: (groupId: string) => Promise<{ points: MapTrackingEncryptedPoint[] }>;
  listGroups: () => Promise<Array<{ id: string }>>;
  now: () => number;
  poll: (input: {
    cursor: MapTrackingCursor | null;
    groupId: string;
    limit: number;
  }) => Promise<{ points: MapTrackingEncryptedPoint[] }>;
  schedule: (callback: () => void, delayMs: number) => { cancel: () => void };
};
