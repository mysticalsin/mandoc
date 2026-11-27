import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { R2Storage } from "@mandoc/cf";
import { createDb } from "@mandoc/db";
import type { Env } from "./env.js";
import { runRetention } from "./retention-job.js";

export class RetentionWorkflow extends WorkflowEntrypoint<Env, { reason: string }> {
  override async run(_event: WorkflowEvent<{ reason: string }>, step: WorkflowStep): Promise<void> {
    await step.do("purge", async () => {
      const result = await runRetention({ db: createDb(this.env.DB), storage: new R2Storage(this.env.BUCKET) }, Date.now());
      return { documents: result.documents, abandoned: result.abandoned };
    });
  }
}
