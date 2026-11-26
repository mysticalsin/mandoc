import { bytesToHex, randomId, type DocumentStorage, type ObjectRange, type StoredSlice } from "@mandoc/core";

interface PendingUpload {
  parts: Map<number, Uint8Array>;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(new Uint8Array(hash));
}

export class MemoryStorage implements DocumentStorage {
  private readonly pending = new Map<string, PendingUpload>();
  private readonly objects = new Map<string, Uint8Array>();

  async createUpload(key: string): Promise<{ uploadId: string }> {
    const uploadId = randomId("mpu");
    this.pending.set(`${key}\n${uploadId}`, { parts: new Map() });
    return { uploadId };
  }

  async putPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<{ etag: string }> {
    const pending = this.pending.get(`${key}\n${uploadId}`);
    if (!pending) throw new Error("upload not found");
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    pending.parts.set(partNumber, copy);
    return { etag: await digest(copy) };
  }

  async completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    const pending = this.pending.get(`${key}\n${uploadId}`);
    if (!pending) throw new Error("upload not found");
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const chunks: Uint8Array[] = [];
    for (const part of sorted) {
      const chunk = pending.parts.get(part.partNumber);
      if (!chunk || (await digest(chunk)) !== part.etag) throw new Error("part mismatch");
      chunks.push(chunk);
    }
    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.objects.set(key, body);
    this.pending.delete(`${key}\n${uploadId}`);
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    this.pending.delete(`${key}\n${uploadId}`);
  }

  async get(key: string, range?: ObjectRange): Promise<StoredSlice | null> {
    const body = this.objects.get(key);
    if (!body) return null;
    if (!range) return { bytes: body, size: body.byteLength };
    const end = Math.min(body.byteLength, range.offset + range.length);
    return { bytes: body.slice(range.offset, end), size: body.byteLength };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class R2Storage implements DocumentStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async createUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
    const upload = await this.bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
    return { uploadId: upload.uploadId };
  }

  async putPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<{ etag: string }> {
    const part = await this.bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, bytes);
    return { etag: part.etag };
  }

  async completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await this.bucket.resumeMultipartUpload(key, uploadId).complete(sorted);
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    await this.bucket.resumeMultipartUpload(key, uploadId).abort();
  }

  async get(key: string, range?: ObjectRange): Promise<StoredSlice | null> {
    const object = await this.bucket.get(key, range ? { range } : undefined);
    if (!object) return null;
    return { bytes: new Uint8Array(await object.arrayBuffer()), size: object.size };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
