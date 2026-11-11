import QRCode from "qrcode";

const roundedRect = ({
  x,
  y,
  width,
  height,
  radii: { topLeft, topRight, bottomRight, bottomLeft },
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  radii: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
}) => {
  const corner = (radius: number, dx: number, dy: number) =>
    radius > 0 ? `a${radius} ${radius} 0 0 1 ${dx * radius} ${dy * radius}` : "";
  return [
    `M${x + topLeft} ${y}`,
    `H${x + width - topRight}`,
    corner(topRight, 1, 1),
    `V${y + height - bottomRight}`,
    corner(bottomRight, -1, 1),
    `H${x + bottomLeft}`,
    corner(bottomLeft, -1, -1),
    `V${y + topLeft}`,
    corner(topLeft, 1, -1),
    "Z",
  ].join("");
};

const evenly = (radius: number) => ({
  topLeft: radius,
  topRight: radius,
  bottomRight: radius,
  bottomLeft: radius,
});

export const createQrCodeShape = (value: string) => {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const finders = [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ];
  const inFinder = (x: number, y: number) =>
    finders.some(
      (finder) => x >= finder.x && x < finder.x + 7 && y >= finder.y && y < finder.y + 7,
    );
  const isData = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && !inFinder(x, y) && Boolean(qr.modules.get(y, x));

  const runs: { x: number; y: number; width: number }[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isData(x, y)) continue;
      const start = x;
      while (isData(x + 1, y)) x += 1;
      runs.push({ x: start, y, width: x - start + 1 });
    }
  }

  const moduleRadius = 0.3;
  const dataPath = runs
    .map((run) => {
      const last = run.x + run.width - 1;
      const radius = (filled: boolean) => (filled ? 0 : moduleRadius);
      return roundedRect({
        ...run,
        height: 1,
        radii: {
          topLeft: radius(isData(run.x, run.y - 1)),
          topRight: radius(isData(last, run.y - 1)),
          bottomRight: radius(isData(last, run.y + 1)),
          bottomLeft: radius(isData(run.x, run.y + 1)),
        },
      });
    })
    .join("");

  const finderPath = finders
    .map(({ x, y }) =>
      [
        roundedRect({ x, y, width: 7, height: 7, radii: evenly(1.5) }),
        roundedRect({ x: x + 1, y: y + 1, width: 5, height: 5, radii: evenly(1) }),
        roundedRect({ x: x + 2, y: y + 2, width: 3, height: 3, radii: evenly(1) }),
      ].join(""),
    )
    .join("");

  return { dataPath, finderPath, finders, runs, size, version: qr.version };
};
