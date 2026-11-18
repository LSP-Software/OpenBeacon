import type { TrackingPoint } from "@openbeacon/encryption";

export type TimelinePosition = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export type TimelinePoint = TrackingPoint & {
  pointId: string;
  revisionPrefix: string;
  streamId: string;
};

export type TimelineDeviceData = {
  deviceId: string;
  points: TimelinePoint[];
  undecryptable: number;
  userId: string;
};

export type TimelineDay = {
  end: number;
  key: string;
  start: number;
};

export type TimelineSegment =
  | { kind: "moving"; start: number; end: number; from: TimelinePosition; to: TimelinePosition }
  | { kind: "stay"; start: number; end: number; position: TimelinePosition }
  | { kind: "noLocation"; start: number; end: number }
  | { kind: "pause"; start: number; end: number; from: TimelinePosition; to: TimelinePosition };

export type Coordinate = [longitude: number, latitude: number];
