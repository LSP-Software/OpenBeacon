import { beforeEach, expect, mock, test } from "bun:test";

const cachedFiles = new Set<string>();
const shared: string[] = [];
let afterPrint = () => {};

const joinPath = (parts: (string | { uri: string })[]) =>
  parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");

mock.module("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = joinPath(parts);
    }
    get exists() {
      return [...cachedFiles].some((file) => file.startsWith(`${this.uri}/`));
    }
    create = () => {};
    delete = () => {
      for (const file of [...cachedFiles]) {
        if (file.startsWith(`${this.uri}/`)) cachedFiles.delete(file);
      }
    };
  },
  File: class {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = joinPath(parts);
    }
    get exists() {
      return cachedFiles.has(this.uri);
    }
    delete = () => {
      cachedFiles.delete(this.uri);
    };
    move = (destination: { uri: string }) => {
      cachedFiles.delete(this.uri);
      cachedFiles.add(destination.uri);
      this.uri = destination.uri;
    };
  },
}));
mock.module("expo-print", () => ({
  printToFileAsync: async () => {
    const uri = `cache/Print/${crypto.randomUUID()}.pdf`;
    cachedFiles.add(uri);
    afterPrint();
    return { uri };
  },
}));
mock.module("expo-sharing", () => ({
  shareAsync: async (uri: string) => {
    shared.push(uri);
  },
}));
mock.module("./thisDeviceNoun.ts", () => ({ thisDeviceNoun: () => "phone" }));

const { clearRecoveryPhrasePdfs, recoveryPhrasePdfHtml, shareRecoveryPhrasePdf } =
  await import("./recoveryPhrasePdf.ts");

beforeEach(() => {
  cachedFiles.clear();
  shared.length = 0;
  afterPrint = () => {};
});

const words = [
  "abandon",
  "ability",
  "able",
  "about",
  "above",
  "absent",
  "absorb",
  "abstract",
  "absurd",
  "abuse",
  "access",
  "accident",
];

test("the PDF lists every word once, numbered in order", () => {
  const html = recoveryPhrasePdfHtml({ words, created: "21 November 2026", noun: "phone" });
  const listed = [
    ...html.matchAll(/<span class="number">(\d+)<\/span><span class="text">([a-z]+)<\/span>/g),
  ].map((match) => [Number(match[1]), match[2]]);

  expect(listed).toEqual(words.map((word, index) => [index + 1, word]));
  expect(html).toContain("These 12 words");
  expect(html).toContain("Created 21 November 2026");
});

test("leaving the screen while printing deletes the printed PDF and never shares it", async () => {
  const controller = new AbortController();
  afterPrint = () => controller.abort();

  await shareRecoveryPhrasePdf({ words, signal: controller.signal });

  expect([...cachedFiles]).toEqual([]);
  expect(shared).toEqual([]);
});

test("each export shares one PDF at a new address and clearing removes every copy", async () => {
  await shareRecoveryPhrasePdf({ words, signal: new AbortController().signal });
  await shareRecoveryPhrasePdf({ words, signal: new AbortController().signal });

  const [first, second] = shared;
  expect(shared).toHaveLength(2);
  expect(first).toMatch(/^cache\/recovery-phrase\/openbeacon-recovery-phrase_[0-9a-f-]+\.pdf$/);
  expect(second).not.toBe(first);
  expect([...cachedFiles]).toEqual(shared.slice(1));

  cachedFiles.add("cache/Print/left-behind.pdf");
  clearRecoveryPhrasePdfs();

  expect([...cachedFiles]).toEqual([]);
});
