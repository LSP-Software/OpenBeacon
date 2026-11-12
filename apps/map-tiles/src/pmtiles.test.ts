import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { isSupportedSchemaVersion, parseHeader, readArchiveInfo } from "./pmtiles.ts";

const createArchive = ({
  compression = 2,
  specVersion = 3,
  version = "4.15.2",
}: {
  compression?: number;
  specVersion?: number;
  version?: string;
} = {}) => {
  const json = new TextEncoder().encode(JSON.stringify({ name: "Protomaps Basemap", version }));
  const metadata = compression === 2 ? gzipSync(json) : json;
  const metadataOffset = 20_000;
  const bytes = new Uint8Array(metadataOffset + metadata.byteLength);
  const view = new DataView(bytes.buffer);

  bytes.set(new TextEncoder().encode("PMTiles"), 0);
  view.setUint8(7, specVersion);
  view.setBigUint64(24, BigInt(metadataOffset), true);
  view.setBigUint64(32, BigInt(metadata.byteLength), true);
  view.setUint8(97, compression);
  bytes.set(metadata, metadataOffset);

  return bytes;
};

const reader = (bytes: Uint8Array) => async (start: number, length: number) =>
  bytes.slice(start, start + length);

describe("readArchiveInfo", () => {
  test("reads the schema version from gzip compressed metadata", async () => {
    const info = await readArchiveInfo(reader(createArchive()));

    expect(info.schemaVersion).toBe("4.15.2");
    expect(info.headBytes.byteLength).toBe(16_384);
  });

  test("reads uncompressed metadata", async () => {
    const info = await readArchiveInfo(reader(createArchive({ compression: 1 })));

    expect(info.schemaVersion).toBe("4.15.2");
  });

  test("rejects basemap schemas the app style does not support", async () => {
    await expect(readArchiveInfo(reader(createArchive({ version: "5.0.0" })))).rejects.toThrow(
      "Basemap schema 5.0.0 is not supported",
    );
  });

  test("rejects other PMTiles spec versions", async () => {
    await expect(readArchiveInfo(reader(createArchive({ specVersion: 2 })))).rejects.toThrow(
      "Unsupported PMTiles spec version 2",
    );
  });

  test("rejects unsupported metadata compression", async () => {
    await expect(readArchiveInfo(reader(createArchive({ compression: 4 })))).rejects.toThrow(
      "Unsupported PMTiles internal compression 4",
    );
  });
});

describe("parseHeader", () => {
  test("rejects data that is not a PMTiles archive", () => {
    expect(() => parseHeader(new Uint8Array(200))).toThrow("does not start with a PMTiles header");
  });
});

describe("isSupportedSchemaVersion", () => {
  test("accepts only the supported major version", () => {
    expect(isSupportedSchemaVersion("4.0.0")).toBe(true);
    expect(isSupportedSchemaVersion("4.15.2")).toBe(true);
    expect(isSupportedSchemaVersion("3.9.9")).toBe(false);
    expect(isSupportedSchemaVersion("40.0.0")).toBe(false);
  });
});
