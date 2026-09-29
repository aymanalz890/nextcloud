// Local development fixture only. Never deploy this process to Azure.
import { fixture } from "./fake-nextcloud.js";
import { createApp } from "../api/server.js";
import { createServer } from "vite";
const nc = fixture();
await new Promise((r) => nc.server.listen(0, "127.0.0.1", r));
createApp({ base: "http://127.0.0.1:" + nc.server.address().port }).listen(
  3000,
  "127.0.0.1",
);
const vite = await createServer({ configFile: "web/vite.config.js" });
await vite.listen();
console.log("Test fixture UI: http://localhost:8081 (synthetic files only)");
