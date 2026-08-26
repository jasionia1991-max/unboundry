import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  root: process.cwd(),
  server: { middlewareMode: true },
});
try {
  const module = await server.ssrLoadModule("/server/modelReleaseBootstrap.ts");
  await module.runModelReleaseBootstrapCli();
} finally {
  await server.close();
}
