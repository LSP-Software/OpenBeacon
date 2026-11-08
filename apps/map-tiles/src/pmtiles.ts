import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const SUPPORTED_SCHEMA_MAJOR = 4;
export const HEADER_CHECK_LENGTH = 16_384;

const metadataSchema = z.object({ version: z.string().min(1) });

export const parseHeader = (bytes: Uint8Array) => {
  if (bytes.byteLength < 127 || new TextDecoder().decode(bytes.subarray(0, 7)) !== "PMTiles") {
    throw new Error("The archive does not start with a PMTiles header");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const specVersion = view.getUint8(7);

  if (specVersion !== 3) {
    throw new Error(`Unsupported PMTiles spec version ${specVersion}`);
  }

  return {
    metadataOffset: Number(view.getBigUint64(24, true)),
    metadataLength: Number(view.getBigUint64(32, true)),
    internalCompression: view.getUint8(97),
  };
};

export const parseMetadata = ({
  bytes,
  internalCompression,
}: {
  bytes: Uint8Array;
  internalCompression: number;
}) => {
  if (internalCompression !== 1 && internalCompression !== 2) {
    throw new Error(`Unsupported PMTiles internal compression ${internalCompression}`);
  }

  const json = internalCompression === 2 ? gunzipSync(bytes) : bytes;
  return metadataSchema.parse(JSON.parse(new TextDecoder().decode(json)));
};

export const isSupportedSchemaVersion = (version: string) =>
  Number(version.split(".")[0]) === SUPPORTED_SCHEMA_MAJOR;

export const readArchiveInfo = async (
  readRange: (start: number, length: number) => Promise<Uint8Array>,
) => {
  const headBytes = await readRange(0, HEADER_CHECK_LENGTH);
  const header = parseHeader(headBytes);
  const metadata = parseMetadata({
    bytes: await readRange(header.metadataOffset, header.metadataLength),
    internalCompression: header.internalCompression,
  });

  if (!isSupportedSchemaVersion(metadata.version)) {
    throw new Error(
      `Basemap schema ${metadata.version} is not supported; the app style expects major version ${SUPPORTED_SCHEMA_MAJOR}`,
    );
  }

  return { headBytes, schemaVersion: metadata.version };
};
