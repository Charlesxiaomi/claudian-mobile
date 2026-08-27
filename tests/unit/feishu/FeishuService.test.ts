import { requestUrl } from "obsidian";

import { FeishuService } from "@/feishu/FeishuService";
import { FeishuOAuthError } from "@/feishu/oauth";
import type { FeishuAuth } from "@/feishu/types";

const requestUrlMock = requestUrl as jest.Mock;

function makeAuth(overrides: Partial<FeishuAuth> = {}): FeishuAuth {
  return {
    clientId: "cli_x",
    clientSecret: "sec",
    accessToken: "at",
    refreshToken: "rt",
    accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    refreshTokenExpiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
    userName: "小米",
    ...overrides,
  };
}

function makeService(initial: FeishuAuth | null): { service: FeishuService; getAuth: () => FeishuAuth | null } {
  let auth = initial;
  const service = new FeishuService(
    () => auth,
    async (next) => {
      auth = next;
    },
  );
  return { service, getAuth: () => auth };
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

describe("FeishuService.getValidAccessToken", () => {
  it("returns the stored token while it is fresh, without any request", async () => {
    const { service } = makeService(makeAuth());
    await expect(service.getValidAccessToken()).resolves.toBe("at");
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("throws a reconnect error when never connected", async () => {
    const { service } = makeService(null);
    await expect(service.getValidAccessToken()).rejects.toMatchObject({ code: "reconnect" });
  });

  it("refreshes an expiring token and persists the rotated pair", async () => {
    const { service, getAuth } = makeService(makeAuth({ accessTokenExpiresAt: Date.now() + 1000 }));
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 7200, refresh_token_expires_in: 604800 }),
    });
    await expect(service.getValidAccessToken()).resolves.toBe("at2");
    expect(getAuth()).toMatchObject({ accessToken: "at2", refreshToken: "rt2" });
    const body = String((requestUrlMock.mock.calls[0][0] as { body: string }).body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt");
  });

  it("collapses concurrent callers into a single refresh request", async () => {
    const { service } = makeService(makeAuth({ accessTokenExpiresAt: Date.now() + 1000 }));
    requestUrlMock.mockResolvedValue({
      status: 200,
      text: JSON.stringify({ access_token: "at2", refresh_token: "rt2", expires_in: 7200, refresh_token_expires_in: 604800 }),
    });
    const [a, b] = await Promise.all([service.getValidAccessToken(), service.getValidAccessToken()]);
    expect(a).toBe("at2");
    expect(b).toBe("at2");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });

  it("drops the session and asks to reconnect when the refresh token is rejected", async () => {
    const { service, getAuth } = makeService(makeAuth({ accessTokenExpiresAt: 0 }));
    requestUrlMock.mockResolvedValueOnce({
      status: 400,
      text: JSON.stringify({ error: "invalid_grant", error_description: "revoked" }),
    });
    await expect(service.getValidAccessToken()).rejects.toMatchObject({ code: "reconnect" });
    // App credentials survive so the next connect skips re-registration.
    expect(getAuth()).toMatchObject({ clientId: "cli_x", refreshToken: "" });
  });

  it("throws reconnect when the refresh token itself has expired", async () => {
    const { service } = makeService(makeAuth({ accessTokenExpiresAt: 0, refreshTokenExpiresAt: Date.now() - 1000 }));
    await expect(service.getValidAccessToken()).rejects.toMatchObject({ code: "reconnect" });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});

describe("FeishuService.disconnect", () => {
  it("clears tokens but keeps the registered app credentials", async () => {
    const { service, getAuth } = makeService(makeAuth());
    await service.disconnect();
    expect(getAuth()).toMatchObject({ clientId: "cli_x", clientSecret: "sec", accessToken: "", refreshToken: "", userName: "" });
    expect(service.isConnected()).toBe(false);
  });
});

describe("FeishuService.isConnected", () => {
  it("is false when only app credentials exist", () => {
    const { service } = makeService(makeAuth({ accessToken: "", refreshToken: "", accessTokenExpiresAt: 0, refreshTokenExpiresAt: 0 }));
    expect(service.isConnected()).toBe(false);
  });
});

describe("FeishuOAuthError", () => {
  it("carries the OAuth error code", () => {
    const err = new FeishuOAuthError("denied", "access_denied");
    expect(err.code).toBe("access_denied");
  });
});
