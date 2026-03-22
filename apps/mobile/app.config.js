const appJson = require("./app.json");

const GOOGLE_PLUGIN_NAME = "@react-native-google-signin/google-signin";

const createExpoConfig = (config = appJson) => {
  const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  const plugins = Array.isArray(config?.expo?.plugins) ? [...config.expo.plugins] : [];
  const hasGooglePlugin = plugins.some(
    (entry) =>
      entry === GOOGLE_PLUGIN_NAME || (Array.isArray(entry) && entry[0] === GOOGLE_PLUGIN_NAME),
  );

  if (googleIosUrlScheme && !hasGooglePlugin) {
    plugins.push([
      GOOGLE_PLUGIN_NAME,
      {
        iosUrlScheme: googleIosUrlScheme,
      },
    ]);
  }

  return {
    ...config.expo,
    plugins,
  };
};

module.exports = createExpoConfig;
module.exports.createExpoConfig = createExpoConfig;
