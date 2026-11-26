export interface ObjectRange {
  offset: number;
  length: number;
}

export interface StoredSlice {
  bytes: Uint8Array;
  size: number;
}

export interface DocumentStorage {
  createUpload(key: string, contentType: string): Promise<{ uploadId: string }>;
  putPart(key: string, uploadId: string, partNumber: number, bytes: Uint8Array): Promise<{ etag: string }>;
  completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortUpload(key: string, uploadId: string): Promise<void>;
  get(key: string, range?: ObjectRange): Promise<StoredSlice | null>;
  delete(key: string): Promise<void>;
}

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  code: string;
  kind: "staff_otp" | "viewer_otp";
  shareId: string | null;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
