import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  root: process.cwd(),
  server: { middlewareMode: true },
});
try {
  const module = await server.ssrLoadModule("/server/modelContractUpgrade.ts");
  await module.runModelContractUpgradeCli();
} finally {
  await server.close();
}
