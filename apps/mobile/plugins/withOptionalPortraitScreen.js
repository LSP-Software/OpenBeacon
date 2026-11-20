const { withAndroidManifest } = require("expo/config-plugins");

const PORTRAIT_FEATURE = "android.hardware.screen.portrait";

const markPortraitScreenOptional = (manifest) => {
  const features = (manifest.manifest["uses-feature"] ?? []).filter(
    (feature) => feature.$["android:name"] !== PORTRAIT_FEATURE,
  );
  return {
    ...manifest,
    manifest: {
      ...manifest.manifest,
      "uses-feature": [
        ...features,
        { $: { "android:name": PORTRAIT_FEATURE, "android:required": "false" } },
      ],
    },
  };
};

const withOptionalPortraitScreen = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = markPortraitScreenOptional(mod.modResults);
    return mod;
  });

withOptionalPortraitScreen.markPortraitScreenOptional = markPortraitScreenOptional;

module.exports = withOptionalPortraitScreen;
