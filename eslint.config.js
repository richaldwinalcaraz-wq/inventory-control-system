const nextConfig = require("eslint-config-next");

module.exports = [
  ...nextConfig,
  {
    ignores: ["tests/node_modules/**"],
  },
];
