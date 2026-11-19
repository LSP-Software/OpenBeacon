import { decodeBase64, encodeBase64 } from "../base64.ts";

export const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const bytes = (length: number) => Uint8Array.from({ length }, () => int(0, 255));
  const text = (maxCodePoints: number) => {
    const ranges: [number, number][] = [
      [0x20, 0x7e],
      [0xa0, 0x2ff],
      [0x400, 0x4ff],
      [0x4e00, 0x9fff],
      [0x1f300, 0x1faff],
    ];
    return String.fromCodePoint(
      ...Array.from({ length: int(0, maxCodePoints) }, () => {
        const range = ranges[int(0, ranges.length - 1)] ?? [0x20, 0x7e];
        return int(range[0], range[1]);
      }),
    );
  };
  return { bytes, int, next, text };
};

export const flipBit = (bytes: Uint8Array, index: number, bit = index % 8) => {
  const copy = Uint8Array.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ (1 << bit);
  return copy;
};

export const everyBitFlip = (bytes: Uint8Array) =>
  Array.from({ length: bytes.length * 8 }, (_, position) =>
    flipBit(bytes, Math.floor(position / 8), position % 8),
  );

export const everyByteFlip = (bytes: Uint8Array) =>
  Array.from({ length: bytes.length }, (_, index) => flipBit(bytes, index));

export const everyTruncation = (bytes: Uint8Array) =>
  Array.from({ length: bytes.length }, (_, length) => bytes.slice(0, length));

export const extensions = (bytes: Uint8Array) => [
  Uint8Array.from([...bytes, 0]),
  Uint8Array.from([...bytes, ...new Uint8Array(16)]),
  Uint8Array.from([0, ...bytes]),
];

export const everyBase64ByteFlip = (value: string) =>
  everyByteFlip(decodeBase64(value)).map(encodeBase64);

export const everyBase64Truncation = (value: string) =>
  everyTruncation(decodeBase64(value)).map(encodeBase64);

export const base64Extensions = (value: string) =>
  extensions(decodeBase64(value)).map(encodeBase64);

export const openedVariants = <T>(variants: T[], open: (variant: T) => unknown) => {
  if (variants.length === 0) throw new Error("No variants to try.");
  return variants.flatMap((variant, index) => {
    try {
      open(variant);
      return [index];
    } catch {
      return [];
    }
  });
};
