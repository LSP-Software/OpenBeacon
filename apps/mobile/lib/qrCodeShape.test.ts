import { describe, expect, test } from "bun:test";
import { encodeBase64, formatDeviceLinkCode } from "@openbeacon/encryption";
import QRCode from "qrcode";
import { createQrCodeShape } from "./qrCodeShape.ts";

const linkCode = formatDeviceLinkCode({
  devicePublicKey: encodeBase64(new Uint8Array(32).map((_, index) => index * 7)),
  linkId: "0f8b6a52-3c1d-4e7f-9a2b-5c6d7e8f9a0b",
  psk: new Uint8Array(32).map((_, index) => 255 - index * 3),
});
const inviteCode = "0123456789ABCDEF0123456789ABCDEF";

const subpathBounds = (path: string) => {
  const tokens = path.match(/[MHVaZ]|-?\d*\.?\d+/g) ?? [];
  const bounds: { left: number; top: number; right: number; bottom: number }[] = [];
  let x = 0;
  let y = 0;
  const visit = () => {
    const current = bounds.at(-1);
    if (!current) throw new Error("Path doesn't start with M");
    current.left = Math.min(current.left, x);
    current.right = Math.max(current.right, x);
    current.top = Math.min(current.top, y);
    current.bottom = Math.max(current.bottom, y);
  };
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++];
    const next = () => Number(tokens[index++]);
    if (command === "M") {
      x = next();
      y = next();
      bounds.push({ left: x, top: y, right: x, bottom: y });
    } else if (command === "H") x = next();
    else if (command === "V") y = next();
    else if (command === "a") {
      index += 5;
      x = Math.round((x + next()) * 1e6) / 1e6;
      y = Math.round((y + next()) * 1e6) / 1e6;
    } else if (command !== "Z") throw new Error(`Unexpected ${command}`);
    visit();
  }
  return bounds;
};

const darkCells = (value: string) => {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const cells = new Set<string>();
  for (let y = 0; y < modules.size; y += 1) {
    for (let x = 0; x < modules.size; x += 1) {
      if (modules.get(y, x)) cells.add(`${x},${y}`);
    }
  }
  return cells;
};

const finderCells = ({ x, y }: { x: number; y: number }) => {
  const cells: string[] = [];
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const ring = row === 0 || row === 6 || column === 0 || column === 6;
      const centre = row >= 2 && row <= 4 && column >= 2 && column <= 4;
      if (ring || centre) cells.push(`${x + column},${y + row}`);
    }
  }
  return cells;
};

describe("createQrCodeShape", () => {
  test.each([
    ["a device link code", linkCode],
    ["a group invite code", inviteCode],
  ])("draws exactly the dark modules of %s", (_name, value) => {
    const shape = createQrCodeShape(value);
    const drawn = new Set<string>();

    const runBounds = subpathBounds(shape.dataPath);
    expect(runBounds).toHaveLength(shape.runs.length);
    shape.runs.forEach((run, index) => {
      expect(runBounds[index]).toEqual({
        left: run.x,
        top: run.y,
        right: run.x + run.width,
        bottom: run.y + 1,
      });
      for (let x = run.x; x < run.x + run.width; x += 1) {
        expect(drawn.has(`${x},${run.y}`)).toBe(false);
        drawn.add(`${x},${run.y}`);
      }
    });

    const finderBounds = subpathBounds(shape.finderPath);
    expect(finderBounds).toEqual(
      shape.finders.flatMap(({ x, y }) => [
        { left: x, top: y, right: x + 7, bottom: y + 7 },
        { left: x + 1, top: y + 1, right: x + 6, bottom: y + 6 },
        { left: x + 2, top: y + 2, right: x + 5, bottom: y + 5 },
      ]),
    );
    for (const finder of shape.finders) {
      for (const cell of finderCells(finder)) {
        expect(drawn.has(cell)).toBe(false);
        drawn.add(cell);
      }
    }

    expect([...drawn].toSorted()).toEqual([...darkCells(value)].toSorted());
  });

  test("keeps medium error correction so the link code isn't any denser than before", () => {
    const shape = createQrCodeShape(linkCode);

    expect(linkCode).toHaveLength(142);
    expect(shape.version).toBe(QRCode.create(linkCode, { errorCorrectionLevel: "M" }).version);
    expect(shape.version).toBe(8);
    expect(shape.size).toBe(49);
  });
});
