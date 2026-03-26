const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const getBase64Padding = (length: number) => {
  const remainder = length % 4;

  if (remainder === 0) {
    return 0;
  }

  return 4 - remainder;
};

export const encodeBase64 = (bytes: Uint8Array) => {
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index] ?? 0;
    const byte2 = bytes[index + 1] ?? 0;
    const byte3 = bytes[index + 2] ?? 0;
    const chunk = (byte1 << 16) | (byte2 << 8) | byte3;

    output += BASE64_ALPHABET[(chunk >> 18) & 63];
    output += BASE64_ALPHABET[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : "=";
  }

  return output;
};

export const decodeBase64 = (value: string) => {
  const sanitizedValue = value.replace(/\s+/g, "");
  const paddingLength = getBase64Padding(sanitizedValue.length);
  const paddedValue = `${sanitizedValue}${"=".repeat(paddingLength)}`;

  if (paddedValue.length % 4 !== 0) {
    throw new Error("Invalid base64 value.");
  }

  const outputLength =
    (paddedValue.length / 4) * 3 -
    (paddedValue.endsWith("==") ? 2 : paddedValue.endsWith("=") ? 1 : 0);
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;

  for (let index = 0; index < paddedValue.length; index += 4) {
    const chunk = paddedValue.slice(index, index + 4);
    const values = chunk.split("").map((character) => {
      if (character === "=") {
        return 0;
      }

      const alphabetIndex = BASE64_ALPHABET.indexOf(character);
      if (alphabetIndex === -1) {
        throw new Error("Invalid base64 value.");
      }

      return alphabetIndex;
    });

    const combined =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);

    if (outputIndex < output.length) {
      output[outputIndex] = (combined >> 16) & 255;
      outputIndex += 1;
    }

    if (chunk[2] !== "=" && outputIndex < output.length) {
      output[outputIndex] = (combined >> 8) & 255;
      outputIndex += 1;
    }

    if (chunk[3] !== "=" && outputIndex < output.length) {
      output[outputIndex] = combined & 255;
      outputIndex += 1;
    }
  }

  return output;
};
