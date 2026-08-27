/** Persisted Feishu connection state, stored inside plugin settings. */
export interface FeishuAuth {
  /** App credentials from the one-click registration flow (or hand-entered). */
  clientId: string;
  clientSecret: string;
  /** Empty string until the device-code authorization has completed. */
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds; 0 when the corresponding token is absent. */
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  /** Display name from user_info, shown in settings ("Connected as …"). */
  userName: string;
}

export function emptyFeishuAuth(): FeishuAuth {
  return {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    accessTokenExpiresAt: 0,
    refreshTokenExpiresAt: 0,
    userName: "",
  };
}
