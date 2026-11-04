module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["react-native-unistyles/plugin", { root: "app", autoProcessImports: ["@/components"] }],
      // Expo 58's preset leaves rest-parameter destructuring as is (`async (...[input, options = {}]) =>`, used by
      // @orpc/client), which the release Hermes compiler rejects ("invalid destructuring target"). Lower parameters
      // and destructuring everywhere, node_modules included.
      "@babel/plugin-transform-destructuring",
      "@babel/plugin-transform-parameters",
    ],
  };
};
