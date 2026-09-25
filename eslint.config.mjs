import nextConfig from "eslint-config-next";
import nextTsConfig from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextConfig,
  ...nextTsConfig,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**"] },
];

export default eslintConfig;
