const appJson = require("./app.json");

const GOOGLE_PLUGIN_NAME = "@react-native-google-signin/google-signin";

const createExpoConfig = (config = appJson.expo) => {
  const expoConfig = config ?? appJson.expo;
  const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  const plugins = Array.isArray(expoConfig?.plugins) ? [...expoConfig.plugins] : [];
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
    ...expoConfig,
    plugins,
  };
};

const expoConfigWrapper = ({ config } = { config: appJson.expo }) => createExpoConfig(config);

module.exports = expoConfigWrapper;
module.exports.createExpoConfig = createExpoConfig;
