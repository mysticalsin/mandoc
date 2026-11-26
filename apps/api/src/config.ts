export type Environment = "production" | "development" | "e2e";
export type MailerMode = "disabled" | "dev-outbox";
export type AuthProvider = "otp" | "cloudflare-access";

export interface AppConfig {
  environment: Environment;
  appOrigin: string;
  mailer: MailerMode;
  authProvider: AuthProvider;
  grantTtlSeconds: number;
  sessionPepper: string;
  otpPepper: string;
  grantSecret: string;
  shareLinkKey: string;
  bootstrapAdminEmail: string;
  accessTeamDomain: string | null;
  accessAudStaff: string | null;
  accessAudViewer: string | null;
}

export interface EnvSource {
  ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  MAILER?: string;
  AUTH_PROVIDER?: string;
  GRANT_TTL_SECONDS?: string;
  SESSION_PEPPER?: string;
  OTP_PEPPER?: string;
  GRANT_SECRET?: string;
  SHARE_LINK_KEY?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD_STAFF?: string;
  ACCESS_AUD_VIEWER?: string;
}

function required(env: EnvSource, key: keyof EnvSource): string {
  const value = env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function parseConfig(env: EnvSource): AppConfig {
  const environment = env.ENVIRONMENT;
  if (environment !== "production" && environment !== "development" && environment !== "e2e") {
    throw new Error("ENVIRONMENT must be production, development, or e2e");
  }
  const mailer: MailerMode = env.MAILER === "dev-outbox" ? "dev-outbox" : "disabled";
  const authProvider: AuthProvider = env.AUTH_PROVIDER === "otp" ? "otp" : "cloudflare-access";
  const accessTeamDomain = env.ACCESS_TEAM_DOMAIN ?? null;
  const accessAudStaff = env.ACCESS_AUD_STAFF ?? null;
  const accessAudViewer = env.ACCESS_AUD_VIEWER ?? null;
  if (environment === "production") {
    if (mailer !== "disabled") throw new Error("production refuses a dev mailer");
    if (authProvider !== "cloudflare-access") throw new Error("production refuses local OTP sign-in");
    if (!accessTeamDomain || !accessAudStaff || !accessAudViewer) throw new Error("production access is not configured");
  }
  return {
    environment,
    appOrigin: required(env, "APP_ORIGIN"),
    mailer,
    authProvider,
    grantTtlSeconds: clamp(Number(env.GRANT_TTL_SECONDS ?? "300"), 30, 3600),
    sessionPepper: required(env, "SESSION_PEPPER"),
    otpPepper: required(env, "OTP_PEPPER"),
    grantSecret: required(env, "GRANT_SECRET"),
    shareLinkKey: required(env, "SHARE_LINK_KEY"),
    bootstrapAdminEmail: required(env, "BOOTSTRAP_ADMIN_EMAIL").trim().toLowerCase(),
    accessTeamDomain,
    accessAudStaff,
    accessAudViewer,
  };
}
