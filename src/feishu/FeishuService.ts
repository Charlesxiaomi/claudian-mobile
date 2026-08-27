import type { FeishuAuth } from "./types";
import { emptyFeishuAuth } from "./types";
import type { DeviceAuthorization } from "./oauth";
import {
  beginAppRegistration,
  FEISHU_TOOL_SCOPES,
  FeishuOAuthError,
  fetchUserName,
  pollAppRegistration,
  pollDeviceToken,
  refreshTokenGrant,
  requestDeviceAuthorization,
} from "./oauth";

/** Refresh the access token this long before it actually expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type ConnectStage = "registering" | "authorizing";

export interface ConnectCallbacks {
  /** Opens the verification URL in the system browser. */
  openUrl: (url: string) => void;
  /** Lets the UI narrate which confirmation the user is being sent to. */
  onStage?: (stage: ConnectStage) => void;
  signal?: AbortSignal;
}

/**
 * Owns the Feishu connection lifecycle: one-click app registration, the
 * device-code authorization, silent token refresh, and disconnect. State
 * lives in plugin settings (`settings.feishu`) and is persisted through the
 * host plugin's saveSettings.
 */
export class FeishuService {
  /** Single-flight guard so concurrent tool calls trigger one refresh. */
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly getAuth: () => FeishuAuth | null,
    private readonly setAuth: (auth: FeishuAuth | null) => Promise<void>,
  ) {}

  isConnected(): boolean {
    const auth = this.getAuth();
    return Boolean(auth && auth.refreshToken && auth.refreshTokenExpiresAt > Date.now());
  }

  connectedUserName(): string {
    return this.getAuth()?.userName ?? "";
  }

  /**
   * Returns an access token that is valid for at least the refresh margin,
   * refreshing silently when needed. Throws FeishuOAuthError("reconnect")
   * when there is no usable session and the user must re-authorize.
   */
  async getValidAccessToken(): Promise<string> {
    const auth = this.getAuth();
    if (!auth || !auth.refreshToken) {
      throw new FeishuOAuthError("Feishu is not connected.", "reconnect");
    }
    if (auth.accessToken && auth.accessTokenExpiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return auth.accessToken;
    }
    if (auth.refreshTokenExpiresAt <= Date.now()) {
      throw new FeishuOAuthError("The Feishu session has expired; please reconnect.", "reconnect");
    }
    this.refreshInFlight ??= this.refresh(auth).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refresh(auth: FeishuAuth): Promise<string> {
    let tokens;
    try {
      tokens = await refreshTokenGrant(auth.clientId, auth.clientSecret, auth.refreshToken);
    } catch (err) {
      // An invalid_grant means the refresh token was revoked or consumed —
      // only a new authorization can recover. Anything else may be transient.
      if (err instanceof FeishuOAuthError && err.code === "invalid_grant") {
        await this.setAuth({ ...auth, accessToken: "", refreshToken: "", accessTokenExpiresAt: 0, refreshTokenExpiresAt: 0 });
        throw new FeishuOAuthError("The Feishu session has expired; please reconnect.", "reconnect");
      }
      throw err;
    }
    const now = Date.now();
    await this.setAuth({
      ...auth,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || auth.refreshToken,
      accessTokenExpiresAt: now + tokens.expiresIn * 1000,
      refreshTokenExpiresAt: tokens.refreshToken ? now + tokens.refreshExpiresIn * 1000 : auth.refreshTokenExpiresAt,
    });
    return tokens.accessToken;
  }

  /**
   * Runs the full connect flow. When no app credentials exist yet, first
   * registers an app (browser confirmation #1), then runs the device-code
   * authorization (browser confirmation #2) and stores the token pair.
   */
  async connect(callbacks: ConnectCallbacks): Promise<void> {
    let auth = this.getAuth() ?? emptyFeishuAuth();

    if (!auth.clientId || !auth.clientSecret) {
      callbacks.onStage?.("registering");
      const registration = await beginAppRegistration();
      this.openVerification(callbacks, registration);
      const app = await pollAppRegistration(registration, callbacks.signal);
      auth = { ...auth, clientId: app.clientId, clientSecret: app.clientSecret };
      // Persist immediately: if the authorization step below fails, the next
      // attempt reuses this app instead of registering another one.
      await this.setAuth(auth);
    }

    callbacks.onStage?.("authorizing");
    const deviceAuth = await requestDeviceAuthorization(auth.clientId, auth.clientSecret, FEISHU_TOOL_SCOPES);
    this.openVerification(callbacks, deviceAuth);
    const tokens = await pollDeviceToken(auth.clientId, auth.clientSecret, deviceAuth, callbacks.signal);

    const now = Date.now();
    const userName = await fetchUserName(tokens.accessToken);
    await this.setAuth({
      ...auth,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: now + tokens.expiresIn * 1000,
      refreshTokenExpiresAt: now + tokens.refreshExpiresIn * 1000,
      userName,
    });
  }

  private openVerification(callbacks: ConnectCallbacks, auth: DeviceAuthorization): void {
    if (!auth.verificationUriComplete) {
      throw new FeishuOAuthError("The server did not return a verification URL.");
    }
    callbacks.openUrl(auth.verificationUriComplete);
  }

  /**
   * Drops the stored tokens but keeps the app credentials, so reconnecting
   * later reuses the same app instead of registering a new one each time.
   */
  async disconnect(): Promise<void> {
    const auth = this.getAuth();
    if (!auth) return;
    await this.setAuth({
      ...auth,
      accessToken: "",
      refreshToken: "",
      accessTokenExpiresAt: 0,
      refreshTokenExpiresAt: 0,
      userName: "",
    });
  }
}
