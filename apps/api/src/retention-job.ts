import type { DocumentStorage } from "@mandoc/core";
import { AUDIT } from "@mandoc/core";
import {
  abandonedUploadIds,
  deleteAbandonedUpload,
  documentsToPurge,
  hardDeleteDocument,
  purgeEphemeral,
  writeAudit,
  type Db,
} from "@mandoc/db";

export async function runRetention(deps: { db: Db; storage: DocumentStorage }, now: number) {
  const abandoned = await abandonedUploadIds(deps.db, now);
  for (const upload of abandoned) {
    await deps.storage.abortUpload(upload.r2Key, upload.multipartId).catch(() => undefined);
    await deps.storage.delete(upload.r2Key);
    await deleteAbandonedUpload(deps.db, upload.uploadId, upload.documentId);
  }
  const due = await documentsToPurge(deps.db, now);
  for (const document of due) {
    for (const key of document.keys) await deps.storage.delete(key);
    await hardDeleteDocument(deps.db, document.id);
  }
  const ephemeral = await purgeEphemeral(deps.db, now);
  await writeAudit(deps.db, {
    actorId: null,
    actorEmail: null,
    action: AUDIT.retention,
    targetType: "retention",
    targetId: "documents",
    metadata: { documents: due.length, abandoned: abandoned.length, grants: ephemeral.grants },
    now,
  });
  return { documents: due.length, abandoned: abandoned.length, ephemeral };
}
