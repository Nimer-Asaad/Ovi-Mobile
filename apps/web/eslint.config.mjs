import baseConfig from "@ovi/config/eslint/base";

export default [
  ...baseConfig,
  {
    files: ["**/*.tsx"],
    rules: {
      "react/react-in-jsx-scope": "off",
    },
  },
];
