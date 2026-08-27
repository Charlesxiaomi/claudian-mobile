import { requestUrl } from "obsidian";

import { FeishuApiError, parseFeishuDocRef, readDocxRawContent, resolveWikiNode, searchDocs } from "@/feishu/api";

const requestUrlMock = requestUrl as jest.Mock;

function respond(body: unknown, status = 200): void {
  requestUrlMock.mockResolvedValueOnce({ status, text: JSON.stringify(body) });
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

describe("parseFeishuDocRef", () => {
  it("parses docx URLs, ignoring query strings", () => {
    expect(parseFeishuDocRef("https://acme.feishu.cn/docx/CGwBdpplOo9xPrxodtbcmQC9nwb?from=share")).toEqual({
      kind: "docx",
      token: "CGwBdpplOo9xPrxodtbcmQC9nwb",
    });
  });

  it("parses wiki URLs", () => {
    expect(parseFeishuDocRef("https://acme.feishu.cn/wiki/AbCdEfGhIjKlMnOpQrStUvWx")).toEqual({
      kind: "wiki",
      token: "AbCdEfGhIjKlMnOpQrStUvWx",
    });
  });

  it("accepts a bare token", () => {
    expect(parseFeishuDocRef("  CGwBdpplOo9xPrxodtbcmQC9nwb ")).toEqual({
      kind: "token",
      token: "CGwBdpplOo9xPrxodtbcmQC9nwb",
    });
  });

  it("flags other document kinds as unsupported instead of invalid", () => {
    expect(parseFeishuDocRef("https://acme.feishu.cn/sheets/AbCdEfGhIjKlMnOpQrStUvWx")).toEqual({
      kind: "unsupported",
      pathType: "sheets",
    });
  });

  it("rejects things that are neither URLs nor tokens", () => {
    expect(parseFeishuDocRef("")).toEqual({ kind: "invalid" });
    expect(parseFeishuDocRef("not a token")).toEqual({ kind: "invalid" });
    expect(parseFeishuDocRef("https://acme.feishu.cn/")).toEqual({ kind: "invalid" });
    expect(parseFeishuDocRef("https://acme.feishu.cn/docx/short")).toEqual({ kind: "invalid" });
  });
});

describe("readDocxRawContent", () => {
  it("unwraps the content field", async () => {
    respond({ code: 0, msg: "success", data: { content: "hello" } });
    await expect(readDocxRawContent("tok", "doc1")).resolves.toBe("hello");
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://open.feishu.cn/open-apis/docx/v1/documents/doc1/raw_content",
        headers: { Authorization: "Bearer tok" },
      }),
    );
  });

  it("throws FeishuApiError with the server message on non-zero code", async () => {
    respond({ code: 131005, msg: "not found" }, 400);
    await expect(readDocxRawContent("tok", "doc1")).rejects.toThrow(FeishuApiError);
  });
});

describe("resolveWikiNode", () => {
  it("returns the underlying document token and type", async () => {
    respond({ code: 0, data: { node: { obj_token: "docTok", obj_type: "docx" } } });
    await expect(resolveWikiNode("tok", "nodeTok")).resolves.toEqual({ objToken: "docTok", objType: "docx" });
  });
});

describe("searchDocs", () => {
  it("posts the query and normalizes the result", async () => {
    respond({
      code: 0,
      data: { docs_entities: [{ docs_token: "t1", docs_type: "docx", title: "Doc", owner_id: "ou_1" }], has_more: true, total: 12 },
    });
    const result = await searchDocs("tok", "报告", 5);
    expect(result).toEqual({
      entities: [{ docs_token: "t1", docs_type: "docx", title: "Doc", owner_id: "ou_1" }],
      hasMore: true,
      total: 12,
    });
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ search_key: "报告", count: 5, offset: 0 }),
      }),
    );
  });
});
