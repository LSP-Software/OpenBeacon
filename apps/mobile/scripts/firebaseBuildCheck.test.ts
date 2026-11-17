import { describe, expect, test } from "bun:test";
import { checkFirebaseValues } from "./firebaseBuildCheck.ts";

const values = {
  FIREBASE_APP_ID: "1:1234:android:abcd",
  FIREBASE_API_KEY: "AIza-test",
  FIREBASE_PROJECT_ID: "openbeacon-test",
  FIREBASE_SENDER_ID: "1234",
};

describe("checkFirebaseValues", () => {
  test("a bundle without the Firebase values fails", () => {
    const result = checkFirebaseValues({ apk: false, env: {} });
    expect(result.problem).toBe("fail");
  });

  test("an APK without the Firebase values warns and builds without push", () => {
    const result = checkFirebaseValues({
      apk: true,
      env: { ...values, FIREBASE_API_KEY: "" },
    });
    expect(result).toEqual({
      problem: "warn",
      message:
        "FIREBASE_API_KEY not set in apps/mobile/.env, so this APK is built without push notifications.",
    });
  });

  test("names every missing value", () => {
    const result = checkFirebaseValues({
      apk: false,
      env: { FIREBASE_APP_ID: values.FIREBASE_APP_ID },
    });
    expect(result.problem === "fail" && result.message).toStartWith(
      "FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_SENDER_ID not set",
    );
  });

  test("both builds pass with all four values", () => {
    expect(checkFirebaseValues({ apk: false, env: values })).toEqual({ problem: null });
    expect(checkFirebaseValues({ apk: true, env: values })).toEqual({ problem: null });
  });
});
