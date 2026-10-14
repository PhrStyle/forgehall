import { connect, migrate } from "./db.js";
import { registerApi } from "./api.js";
import { registerGitHttp } from "./git-http.js";
import { buildHttp } from "./http.js";
import { Store } from "./store.js";

export { connect, migrate } from "./db.js";
export { Store, BusError, nextState } from "./store.js";
export { route } from "./router.js";
export { buildPrompt } from "./prompt.js";
export { buildHttp } from "./http.js";
export { registerApi } from "./api.js";

async function main() {
  const sql = connect();
  const applied = await migrate(sql);
  const store = new Store(sql);
  const app = buildHttp(store, {
    maxRunning: Number(process.env.MAX_RUNNING ?? 2),
    claimWaitMs: Number(process.env.CLAIM_WAIT_MS ?? 25_000),
  });
  await registerApi(app, store);
  await registerGitHttp(app, store);
  // Runs whose runner went silent are failed and their messages re-queued.
  const staleAfter = Number(process.env.RUN_STALE_SECONDS ?? 300);
  const reaper = setInterval(() => {
    store.reapStaleRuns(staleAfter).then(
      (ids) => ids.length && app.log.warn({ runs: ids }, "failed stale runs"),
      (e) => app.log.error(e, "stale run check failed"),
    );
  }, 30_000);
  app.addHook("onClose", async () => clearInterval(reaper));
  if (applied.length) app.log.info({ applied }, "migrations applied");
  const port = Number(process.env.PORT ?? 4545);
  // Loopback only: agent tokens travel in plain HTTP and the API has no TLS yet.
  await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
