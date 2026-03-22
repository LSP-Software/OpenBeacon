module.exports = (api) => {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    plugins: [
      "react-native-worklets/plugin", // must be last in the plugins list
    ],
  };
};
