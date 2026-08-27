import { requestUrl } from "obsidian";

/**
 * Feishu OAuth 2.0 device-code flow (RFC 8628) and the app-registration
 * variant behind lark-cli's one-click setup.
 *
 * The accounts.feishu.cn endpoints are not publicly documented. Parameter
 * shapes mirror larksuite/cli internal/auth/{device_flow,app_registration}.go
 * and were verified end-to-end on 2026-08-27 (docs/feishu-oauth-spike.md).
 * A 4xx or an unexpected response shape here most likely means the contract
 * drifted — fail with the server's message instead of retrying.
 */

const ACCOUNTS_BASE = "https://accounts.feishu.cn";
const OPEN_BASE = "https://open.feishu.cn";

const DEVICE_AUTHORIZATION_URL = `${ACCOUNTS_BASE}/oauth/v1/device_authorization`;
const APP_REGISTRATION_URL = `${ACCOUNTS_BASE}/oauth/v1/app/registration`;
const TOKEN_URL = `${OPEN_BASE}/open-apis/authen/v2/oauth/token`;
const USER_INFO_URL = `${OPEN_BASE}/open-apis/authen/v1/user_info`;

/**
 * Everything the bundled tools need. Requested scopes are auto-approved on
 * the consent page without any developer-console setup; offline_access is
 * what makes the server return a refresh_token.
 */
export const FEISHU_TOOL_SCOPES = [
  "offline_access",
  "docx:document:readonly",
  "docs:document.content:read",
  "drive:drive.metadata:readonly",
  "wiki:node:read",
  "search:docs:read",
].join(" ");

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  /** Must be opened exactly as returned — the server forbids reconstructing it. */
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface FeishuTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds, as reported by the server. */
  expiresIn: number;
  refreshExpiresIn: number;
  scope: string;
}

export class FeishuOAuthError extends Error {
  constructor(
    message: string,
    /** OAuth error code such as "access_denied" or "expired_token", when known. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "FeishuOAuthError";
  }
}

function formEncode(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function postForm(url: string, fields: Record<string, string>, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const resp = await requestUrl({
    url,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    headers,
    body: formEncode(fields),
    // Pending device-code polls answer with non-2xx statuses; those are
    // protocol states, not transport failures.
    throw: false,
  });
  try {
    return JSON.parse(resp.text) as Record<string, unknown>;
  } catch {
    throw new FeishuOAuthError(`Feishu OAuth endpoint returned HTTP ${resp.status} with a non-JSON body.`);
  }
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

function num(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function errorOf(data: Record<string, unknown>): FeishuOAuthError | null {
  const code = str(data, "error");
  if (!code) return null;
  return new FeishuOAuthError(str(data, "error_description") || code, code);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new FeishuOAuthError("Cancelled.", "cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Generic device-code poll loop: calls `once` every `interval` seconds until
 * it returns a value, honoring the OAuth pending/slow_down protocol states
 * and the device code's expiry budget.
 */
async function pollUntil<T>(once: () => Promise<T | null>, intervalSeconds: number, expiresInSeconds: number, signal?: AbortSignal): Promise<T> {
  let interval = Math.max(1, intervalSeconds);
  const deadline = Date.now() + expiresInSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000, signal);
    let result: T | null;
    try {
      result = await once();
    } catch (err) {
      if (err instanceof FeishuOAuthError) {
        if (err.code === "authorization_pending") continue;
        if (err.code === "slow_down") {
          interval = Math.min(interval + 5, 60);
          continue;
        }
        throw err;
      }
      // Transient transport error: back off slightly and keep polling.
      interval = Math.min(interval + 1, 60);
      continue;
    }
    if (result !== null) return result;
  }
  throw new FeishuOAuthError("Authorization timed out, please try again.", "expired_token");
}

function parseDeviceAuthorization(data: Record<string, unknown>): DeviceAuthorization {
  const deviceCode = str(data, "device_code");
  if (!deviceCode) throw new FeishuOAuthError("Response is missing device_code.");
  const verificationUri = str(data, "verification_uri");
  return {
    deviceCode,
    userCode: str(data, "user_code"),
    verificationUriComplete: str(data, "verification_uri_complete") || verificationUri,
    expiresIn: num(data, "expires_in", 600),
    interval: num(data, "interval", 5),
  };
}

/** Starts the one-click app registration; the user confirms in a browser. */
export async function beginAppRegistration(): Promise<DeviceAuthorization> {
  const data = await postForm(APP_REGISTRATION_URL, {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id tenant_brand",
  });
  const err = errorOf(data);
  if (err) throw err;
  const auth = parseDeviceAuthorization(data);
  // The registration begin response reports its budget as expire_in.
  auth.expiresIn = num(data, "expire_in", auth.expiresIn);
  return auth;
}

export interface RegisteredApp {
  clientId: string;
  clientSecret: string;
}

/** Polls the registration endpoint until the user has confirmed app creation. */
export function pollAppRegistration(auth: DeviceAuthorization, signal?: AbortSignal): Promise<RegisteredApp> {
  return pollUntil(
    async () => {
      const data = await postForm(APP_REGISTRATION_URL, {
        action: "poll",
        device_code: auth.deviceCode,
      });
      const err = errorOf(data);
      if (err) throw err;
      const clientId = str(data, "client_id");
      const clientSecret = str(data, "client_secret");
      // A non-error response without full credentials means "keep polling".
      if (!clientId || !clientSecret) return null;
      return { clientId, clientSecret };
    },
    auth.interval,
    auth.expiresIn,
    signal,
  );
}

/** Starts a device-code authorization for the given app and scopes. */
export async function requestDeviceAuthorization(clientId: string, clientSecret: string, scope: string): Promise<DeviceAuthorization> {
  const data = await postForm(
    DEVICE_AUTHORIZATION_URL,
    { client_id: clientId, scope },
    // Unlike the token endpoint, this one authenticates the app via Basic auth.
    { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
  );
  const err = errorOf(data);
  if (err) throw err;
  return parseDeviceAuthorization(data);
}

function parseTokenSet(data: Record<string, unknown>): FeishuTokenSet {
  const accessToken = str(data, "access_token");
  if (!accessToken) throw new FeishuOAuthError("Token response is missing access_token.");
  return {
    accessToken,
    refreshToken: str(data, "refresh_token"),
    expiresIn: num(data, "expires_in", 7200),
    refreshExpiresIn: num(data, "refresh_token_expires_in", 604800),
    scope: str(data, "scope"),
  };
}

/** Polls the token endpoint until the user has approved the authorization. */
export function pollDeviceToken(clientId: string, clientSecret: string, auth: DeviceAuthorization, signal?: AbortSignal): Promise<FeishuTokenSet> {
  return pollUntil(
    async () => {
      const data = await postForm(TOKEN_URL, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: auth.deviceCode,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const err = errorOf(data);
      if (err) throw err;
      return parseTokenSet(data);
    },
    auth.interval,
    auth.expiresIn,
    signal,
  );
}

/** Exchanges a refresh token for a fresh token pair (the pair rotates). */
export async function refreshTokenGrant(clientId: string, clientSecret: string, refreshToken: string): Promise<FeishuTokenSet> {
  const data = await postForm(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const err = errorOf(data);
  if (err) throw err;
  return parseTokenSet(data);
}

/** Fetches the authorized user's display name (for the settings status line). */
export async function fetchUserName(accessToken: string): Promise<string> {
  const resp = await requestUrl({
    url: USER_INFO_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
    throw: false,
  });
  try {
    const data = JSON.parse(resp.text) as { code?: number; data?: { name?: string } };
    if (data.code === 0) return data.data?.name ?? "";
  } catch {
    // Cosmetic only — a connection without a display name is still valid.
  }
  return "";
}
