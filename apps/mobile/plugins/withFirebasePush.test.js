const { describe, expect, test } = require("bun:test");
const { applyFirebaseStrings } = require("./withFirebasePush.js");

const values = {
  FIREBASE_APP_ID: "1:1234:android:abcd",
  FIREBASE_API_KEY: "AIza-test",
  FIREBASE_PROJECT_ID: "openbeacon-test",
  FIREBASE_SENDER_ID: "1234",
};

const names = (strings) => (strings.resources.string ?? []).map((item) => item.$.name);

describe("withFirebasePush", () => {
  test("writes the four values as untranslatable strings", () => {
    const strings = applyFirebaseStrings({ resources: {} }, values);
    expect(strings.resources.string).toEqual([
      {
        $: { name: "openbeacon_firebase_app_id", translatable: "false" },
        _: "1:1234:android:abcd",
      },
      { $: { name: "openbeacon_firebase_api_key", translatable: "false" }, _: "AIza-test" },
      {
        $: { name: "openbeacon_firebase_project_id", translatable: "false" },
        _: "openbeacon-test",
      },
      { $: { name: "openbeacon_firebase_sender_id", translatable: "false" }, _: "1234" },
    ]);
  });

  test("writes nothing when any value is missing, so push is skipped", () => {
    expect(names(applyFirebaseStrings({ resources: {} }, {}))).toEqual([]);
    expect(
      names(applyFirebaseStrings({ resources: {} }, { ...values, FIREBASE_SENDER_ID: " " })),
    ).toEqual([]);
  });

  test("removes values an earlier prebuild wrote", () => {
    const written = applyFirebaseStrings(
      { resources: { string: [{ $: { name: "app_name" }, _: "Open Beacon" }] } },
      values,
    );
    expect(names(applyFirebaseStrings(written, {}))).toEqual(["app_name"]);
  });
});
