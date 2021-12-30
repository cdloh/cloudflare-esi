export default {
  preset: "ts-jest/presets/default-esm",
  globals: {
    "ts-jest": {
      tsconfig: "test/tsconfig.json",
      useESM: true,
    },
  },
  collectCoverageFrom: ["src/*.ts"],
  testEnvironment: "miniflare",
};
