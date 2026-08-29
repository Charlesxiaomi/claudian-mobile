import { requestUrl } from "obsidian";

import { callTikHub, DEFAULT_TIKHUB_BASE_URL, parseDouyinVideoRef, parseXhsNoteRef, searchXhsNotes, TikHubApiError } from "@/tikhub/api";

const requestUrlMock = requestUrl as jest.Mock;

const config = { apiKey: "tk-test", baseUrl: DEFAULT_TIKHUB_BASE_URL };

function respond(body: unknown, status = 200): void {
  requestUrlMock.mockResolvedValueOnce({ status, text: JSON.stringify(body) });
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

describe("parseDouyinVideoRef", () => {
  it("accepts a bare numeric id", () => {
    expect(parseDouyinVideoRef(" 7431951234567890123 ")).toEqual({ kind: "id", awemeId: "7431951234567890123" });
  });

  it("extracts the id from a long-form video URL", () => {
    expect(parseDouyinVideoRef("https://www.douyin.com/video/7431951234567890123?from=share")).toEqual({
      kind: "id",
      awemeId: "7431951234567890123",
    });
  });

  it("extracts the id from a modal_id URL", () => {
    expect(parseDouyinVideoRef("https://www.douyin.com/discover?modal_id=7431951234567890123")).toEqual({
      kind: "id",
      awemeId: "7431951234567890123",
    });
  });

  it("pulls the short link out of a full share text", () => {
    const share = "8.23 复制打开抖音，看看这个视频 https://v.douyin.com/iAbCdEf/ 复制此链接";
    expect(parseDouyinVideoRef(share)).toEqual({ kind: "share_url", url: "https://v.douyin.com/iAbCdEf/" });
  });

  it("rejects text with no douyin link or id", () => {
    expect(parseDouyinVideoRef("")).toEqual({ kind: "invalid" });
    expect(parseDouyinVideoRef("https://www.bilibili.com/video/BV1xx411c7mD")).toEqual({ kind: "invalid" });
  });
});

describe("callTikHub", () => {
  it("sends the bearer token and unwraps the data field", async () => {
    respond({ code: 200, data: { hello: "world" } });
    await expect(callTikHub(config, "/api/v1/x", { a: "b", skip: undefined })).resolves.toEqual({ hello: "world" });
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.tikhub.io/api/v1/x?a=b",
        headers: { Authorization: "Bearer tk-test" },
      }),
    );
  });

  it("throws on a non-200 envelope code", async () => {
    respond({ code: 400, message: "Invalid aweme_id" });
    await expect(callTikHub(config, "/api/v1/x", {})).rejects.toThrow(TikHubApiError);
  });

  it("maps 401 to an actionable key error", async () => {
    respond({ detail: "Unauthorized" }, 401);
    await expect(callTikHub(config, "/api/v1/x", {})).rejects.toThrow(/API key/);
  });

  it("throws on non-JSON bodies", async () => {
    requestUrlMock.mockResolvedValueOnce({ status: 502, text: "<html>bad gateway</html>" });
    await expect(callTikHub(config, "/api/v1/x", {})).rejects.toThrow(/non-JSON/);
  });

  it("falls back to the default base URL when the setting is blank", async () => {
    respond({ code: 200, data: {} });
    await callTikHub({ apiKey: "tk", baseUrl: "  " }, "/api/v1/x", {});
    expect(requestUrlMock.mock.calls[0][0].url).toBe("https://api.tikhub.io/api/v1/x");
  });

  it("retries network failures on the sibling domain", async () => {
    requestUrlMock.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_TIMED_OUT"));
    respond({ code: 200, data: { ok: true } });
    await expect(callTikHub(config, "/api/v1/x", {})).resolves.toEqual({ ok: true });
    expect(requestUrlMock.mock.calls[0][0].url).toBe("https://api.tikhub.io/api/v1/x");
    expect(requestUrlMock.mock.calls[1][0].url).toBe("https://api.tikhub.dev/api/v1/x");
  });

  it("does not retry API-level errors on the sibling domain", async () => {
    respond({ code: 400, message: "Invalid parameter" });
    await expect(callTikHub(config, "/api/v1/x", {})).rejects.toThrow("Invalid parameter");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
  });
});

describe("searchXhsNotes", () => {
  it("encodes the keyword and optional params", async () => {
    respond({ code: 200, data: {} });
    await searchXhsNotes(config, { keyword: "美食", page: 2, sortType: "time_descending" });
    const url = requestUrlMock.mock.calls[0][0].url as string;
    expect(url).toContain("/api/v1/xiaohongshu/app_v2/search_notes?");
    expect(url).toContain(`keyword=${encodeURIComponent("美食")}`);
    expect(url).toContain("page=2");
    expect(url).toContain("sort_type=time_descending");
    expect(url).not.toContain("note_type");
  });
});

describe("parseXhsNoteRef", () => {
  it("accepts a bare note id", () => {
    expect(parseXhsNoteRef(" 6A881584000000002a0135a5 ")).toEqual({ kind: "id", noteId: "6a881584000000002a0135a5" });
  });

  it("extracts the id from explore and discovery URLs", () => {
    expect(parseXhsNoteRef("https://www.xiaohongshu.com/explore/6a881584000000002a0135a5?xsec_token=AB")).toEqual({
      kind: "id",
      noteId: "6a881584000000002a0135a5",
    });
    expect(parseXhsNoteRef("https://www.xiaohongshu.com/discovery/item/6a881584000000002a0135a5")).toEqual({
      kind: "id",
      noteId: "6a881584000000002a0135a5",
    });
  });

  it("pulls a short link out of a full share text", () => {
    const share = "72 张咋啦发布了一篇小红书笔记，快来看吧！ 😆 http://xhslink.com/a/AbCd123，复制本条信息";
    expect(parseXhsNoteRef(share)).toEqual({ kind: "share", url: "http://xhslink.com/a/AbCd123" });
  });

  it("rejects unrelated input", () => {
    expect(parseXhsNoteRef("")).toEqual({ kind: "invalid" });
    expect(parseXhsNoteRef("https://www.douyin.com/video/123")).toEqual({ kind: "invalid" });
    expect(parseXhsNoteRef("6a88")).toEqual({ kind: "invalid" });
  });
});
