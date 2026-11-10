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
  ) => Promise<{ points: MapTrackingEncryptedPoint[] }>;
  listGroups: (signal: AbortSignal) => Promise<Array<{ id: string }>>;
  now: () => number;
  poll: (
    input: {
      cursor: MapTrackingCursor | null;
      groupId: string;
      limit: number;
    },
    signal: AbortSignal,
  ) => Promise<{ points: MapTrackingEncryptedPoint[] }>;
  schedule: (callback: () => void, delayMs: number) => { cancel: () => void };
};

export type MapTrackingStatus = {
  connection: "ok" | "failing";
  groups: Readonly<Record<string, "loaded" | "failed">>;
  membership: "loading" | "loaded" | "failed";
  undecryptable: readonly { groupId: string; userId: string }[];
};
