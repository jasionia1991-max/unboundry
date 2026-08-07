import base from "./playwright.config";

const preview = process.env.UNBOUNDRY_TEST_PREVIEW === "1";

export default {
  ...base,
  use: { ...base.use, baseURL: "http://127.0.0.1:4174" },
  webServer: {
    ...base.webServer,
    command: preview
      ? "npm run preview -- --port 4174 --strictPort"
      : "npm run dev -- --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
  },
};
