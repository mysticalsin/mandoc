export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  RETENTION?: Workflow;
  ENVIRONMENT: string;
  APP_ORIGIN: string;
  MAILER?: string;
  AUTH_PROVIDER?: string;
  GRANT_TTL_SECONDS?: string;
  SESSION_PEPPER: string;
  OTP_PEPPER: string;
  GRANT_SECRET: string;
  SHARE_LINK_KEY: string;
  BOOTSTRAP_ADMIN_EMAIL: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD_STAFF?: string;
  ACCESS_AUD_VIEWER?: string;
}
