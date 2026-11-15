export const PLACE_GEOMETRY_KIND = "placeGeometry" as const;

export type PlaceGeometryV1 = {
  v: 1;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

const PLACE_GEOMETRY_V1_BYTES = 128;

const textEncoder = new TextEncoder();

export const validatePlaceGeometryV1 = (value: unknown): PlaceGeometryV1 => {
  const fields = new Map<string, unknown>(
    typeof value === "object" && value !== null ? Object.entries(value) : [],
  );
  const latitude = fields.get("latitude");
  const longitude = fields.get("longitude");
  const radiusMeters = fields.get("radiusMeters");

  if (
    fields.size !== 4 ||
    fields.get("v") !== 1 ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof radiusMeters !== "number" ||
    !Number.isInteger(radiusMeters) ||
    radiusMeters < 100 ||
    radiusMeters > 1000 ||
    radiusMeters % 25 !== 0
  ) {
    throw new Error("Invalid place geometry.");
  }

  return { v: 1, latitude, longitude, radiusMeters };
};

export const encodePlaceGeometryV1 = (placeGeometry: PlaceGeometryV1) => {
  const json = JSON.stringify(validatePlaceGeometryV1(placeGeometry));

  if (json.length > PLACE_GEOMETRY_V1_BYTES) {
    throw new Error("Invalid place geometry.");
  }

  return textEncoder.encode(json.padEnd(PLACE_GEOMETRY_V1_BYTES, " "));
};
