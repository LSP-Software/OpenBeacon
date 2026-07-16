export const TRACKING_POINT_KIND = "trackingPoint" as const;

export type TrackingPointV1 = {
  v: 1;
  latitude: number;
  longitude: number;
  timestamp: string;
  speed: number | null;
  battery: {
    level: number;
    charging: boolean;
  };
};

const textEncoder = new TextEncoder();

export const validateTrackingPointV1 = (value: unknown): TrackingPointV1 => {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.keys(value).length !== 6 ||
    !("v" in value) ||
    value.v !== 1 ||
    !("latitude" in value) ||
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    !("longitude" in value) ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !("timestamp" in value) ||
    typeof value.timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.timestamp) ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    !("speed" in value) ||
    (typeof value.speed !== "number" && value.speed !== null) ||
    (typeof value.speed === "number" && !Number.isFinite(value.speed)) ||
    !("battery" in value) ||
    typeof value.battery !== "object" ||
    value.battery === null ||
    Object.keys(value.battery).length !== 2 ||
    !("level" in value.battery) ||
    typeof value.battery.level !== "number" ||
    !Number.isInteger(value.battery.level) ||
    value.battery.level < 0 ||
    value.battery.level > 100 ||
    !("charging" in value.battery) ||
    typeof value.battery.charging !== "boolean"
  ) {
    throw new Error("Invalid tracking point.");
  }

  return value as TrackingPointV1;
};

export const encodeTrackingPointV1 = (trackingPoint: TrackingPointV1) =>
  textEncoder.encode(JSON.stringify(validateTrackingPointV1(trackingPoint)));
