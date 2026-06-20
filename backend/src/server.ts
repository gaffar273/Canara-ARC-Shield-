import { config } from "./config/index.js";
import { ensureDir } from "./store/persistence.js";
import { createApp } from "./app.js";
// Importing the orchestrator registers its queue worker at boot.
import "./services/orchestrator.js";

async function main(): Promise<void> {
  await ensureDir(config.paths.uploads);
  await ensureDir(config.paths.documents);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(
      `[arc-shield] listening on :${config.port} (${config.env}) ` +
        `agents=${[config.agents.node1Url, config.agents.node2Url, config.agents.node3Url]
          .map((u) => (u ? "live" : "stub"))
          .join("/")}`,
    );
  });
}

main().catch((err) => {
  console.error("[arc-shield] failed to start", err);
  process.exit(1);
});
