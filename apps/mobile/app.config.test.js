const { afterEach, beforeEach, describe, expect, test } = require("bun:test");

const loadCreateExpoConfig = () => {
  const appConfigPath = require.resolve("./app.config.js");
  delete require.cache[appConfigPath];
  return require("./app.config.js").createExpoConfig;
};

describe("app config", () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  });

  test("returns an empty plugins array when expo plugins are missing", () => {
    const createExpoConfig = loadCreateExpoConfig();

    expect(createExpoConfig({}).plugins).toEqual([]);
  });

  test("adds the Google plugin when the iOS URL scheme is configured", () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = "com.googleusercontent.apps.test";
    const createExpoConfig = loadCreateExpoConfig();

    expect(createExpoConfig({ plugins: ["expo-router"] }).plugins).toEqual([
      "expo-router",
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme: "com.googleusercontent.apps.test",
        },
      ],
    ]);
  });

  test("does not add a duplicate Google plugin when it already exists as a string", () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = "com.googleusercontent.apps.test";
    const createExpoConfig = loadCreateExpoConfig();

    expect(
      createExpoConfig({
        plugins: ["expo-router", "@react-native-google-signin/google-signin"],
      }).plugins,
    ).toEqual(["expo-router", "@react-native-google-signin/google-signin"]);
  });

  test("does not add a duplicate Google plugin when it already exists as a tuple", () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = "com.googleusercontent.apps.test";
    const createExpoConfig = loadCreateExpoConfig();

    expect(
      createExpoConfig({
        plugins: [
          "expo-router",
          [
            "@react-native-google-signin/google-signin",
            {
              iosUrlScheme: "existing-scheme",
            },
          ],
        ],
      }).plugins,
    ).toEqual([
      "expo-router",
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme: "existing-scheme",
        },
      ],
    ]);
  });

  test("preserves the expo config shape when Expo passes the request object", () => {
    const appConfig = require("./app.config.js");

    expect(
      appConfig({
        config: {
          android: {
            package: "net.openbeacon.app",
          },
          plugins: ["expo-router"],
        },
      }),
    ).toEqual({
      android: {
        package: "net.openbeacon.app",
      },
      plugins: ["expo-router"],
    });
  });
});
