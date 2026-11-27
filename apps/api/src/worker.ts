import { R2Storage, verifyAccessJwt } from "@mandoc/cf";
import { createDb } from "@mandoc/db";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import type { Env } from "./env.js";
import { runRetention } from "./retention-job.js";

export { RetentionWorkflow } from "./workflow.js";

function appFor(env: Env) {
  const config = parseConfig(env);
  return createApp({
    db: createDb(env.DB),
    storage: new R2Storage(env.BUCKET),
    config,
    verifyAccess: async (jwt, audience) => {
      if (!config.accessTeamDomain || !config.accessAudStaff || !config.accessAudViewer) return null;
      return verifyAccessJwt({
        jwt,
        teamDomain: config.accessTeamDomain,
        audience: audience === "staff" ? config.accessAudStaff : config.accessAudViewer,
      });
    },
    assets: env.ASSETS,
  });
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return appFor(env).fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        if (env.RETENTION) {
          await env.RETENTION.create({ params: { reason: "cron" } });
          return;
        }
        await runRetention({ db: createDb(env.DB), storage: new R2Storage(env.BUCKET) }, Date.now());
      })(),
    );
  },
};
