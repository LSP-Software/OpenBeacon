import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createReactNativeTestModule } from "../test/reactNativeTestModule.ts";

const shown: string[] = [];
let showFails = false;

mock.module("react-native", () => ({
  ...createReactNativeTestModule({ platformOS: "android" }),
  PermissionsAndroid: {},
}));

mock.module("../modules/openbeacon-tracking/index.ts", () => ({
  default: {
    showNotice: (kind: string) => {
      if (showFails) throw new Error("Unknown notice");
      shown.push(kind);
      return true;
    },
  },
}));

const { showNotice } = await import("./notifications.ts");

beforeEach(() => {
  shown.length = 0;
  showFails = false;
});

describe("showNotice", () => {
  test("only tells self-hosters their own server needs updating", async () => {
    await showNotice({ kind: "compatibility", problem: "serverTooOld", selfHosted: true });
    await showNotice({ kind: "compatibility", problem: "serverTooOld", selfHosted: false });
    await showNotice({ kind: "compatibility", problem: "appTooOld", selfHosted: true });
    expect(shown).toEqual(["selfHostedServerTooOld", "serverTooOld", "appTooOld"]);
  });

  test("reports the notice as not shown when Android refuses it", async () => {
    showFails = true;
    expect(await showNotice({ kind: "signedOut" })).toBe(false);
  });
});
