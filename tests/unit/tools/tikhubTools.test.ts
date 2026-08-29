import { requestUrl } from "obsidian";

import { DEFAULT_TIKHUB_BASE_URL } from "@/tikhub/api";
import { createDouyinGetVideoTool, summarizeDouyinVideo, TIKHUB_NOT_CONFIGURED } from "@/tools/tikhubDouyinVideo";
import { createXhsSearchNotesTool, extractSearchSession, extractXhsNotes } from "@/tools/tikhubXhsSearch";

const requestUrlMock = requestUrl as jest.Mock;

const getConfig = () => ({ apiKey: "tk-test", baseUrl: DEFAULT_TIKHUB_BASE_URL });
const getUnconfigured = () => ({ apiKey: "", baseUrl: DEFAULT_TIKHUB_BASE_URL });

function respond(body: unknown, status = 200): void {
  requestUrlMock.mockResolvedValueOnce({ status, text: JSON.stringify(body) });
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

const AWEME_DETAIL = {
  aweme_id: "7431951234567890123",
  desc: "一条测试视频 #测试",
  create_time: 1724800000,
  author: { nickname: "测试作者", unique_id: "tester" },
  statistics: { digg_count: 1200, comment_count: 34, collect_count: 56, share_count: 7 },
  video: { duration: 15500 },
  share_url: "https://www.iesdouyin.com/share/video/7431951234567890123/",
};

describe("summarizeDouyinVideo", () => {
  it("formats the interesting fields", () => {
    const summary = summarizeDouyinVideo({ aweme_detail: AWEME_DETAIL });
    expect(summary).toContain("一条测试视频");
    expect(summary).toContain("测试作者 (@tester)");
    expect(summary).toContain("likes 1200");
    expect(summary).toContain("Duration: 16s");
    expect(summary).toContain("2024-08");
  });

  it("returns null for unrecognizable payloads", () => {
    expect(summarizeDouyinVideo({ something: "else" })).toBeNull();
    expect(summarizeDouyinVideo(null)).toBeNull();
  });
});

describe("douyin_get_video tool", () => {
  it("asks for configuration when no key is set", async () => {
    const result = await createDouyinGetVideoTool(getUnconfigured).execute({ url_or_id: "123456" });
    expect(result).toEqual({ content: TIKHUB_NOT_CONFIGURED, isError: true });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("resolves an id locally and calls fetch_one_video", async () => {
    respond({ code: 200, data: { aweme_detail: AWEME_DETAIL } });
    const result = await createDouyinGetVideoTool(getConfig).execute({
      url_or_id: "https://www.douyin.com/video/7431951234567890123",
    });
    expect(requestUrlMock.mock.calls[0][0].url).toContain("fetch_one_video?aweme_id=7431951234567890123");
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("测试作者");
  });

  it("routes short share links through the share-url endpoint", async () => {
    respond({ code: 200, data: { aweme_detail: AWEME_DETAIL } });
    await createDouyinGetVideoTool(getConfig).execute({ url_or_id: "看看 https://v.douyin.com/iAbCdEf/ 复制此链接" });
    const url = requestUrlMock.mock.calls[0][0].url as string;
    expect(url).toContain("fetch_one_video_by_share_url");
    expect(url).toContain(encodeURIComponent("https://v.douyin.com/iAbCdEf/"));
  });

  it("rejects inputs without a link or id", async () => {
    const result = await createDouyinGetVideoTool(getConfig).execute({ url_or_id: "随便一句话" });
    expect(result.isError).toBe(true);
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("surfaces TikHub errors as tool errors", async () => {
    respond({ code: 400, message: "Invalid aweme_id" });
    const result = await createDouyinGetVideoTool(getConfig).execute({ url_or_id: "1234567" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid aweme_id");
  });
});

const XHS_PAYLOAD = {
  search_id: "sid123",
  search_session_id: "ssid456",
  items: [
    {
      id: "66f0aa11000000001e02b111",
      model_type: "note",
      note: {
        note_id: "66f0aa11000000001e02b111",
        title: "周末探店",
        desc: "一家很好吃的小店",
        type: "normal",
        user: { nickname: "小红薯" },
        interact_info: { liked_count: "1.2万", comment_count: "88", collected_count: "3400" },
      },
    },
    {
      id: "66f0bb22000000001e02b222",
      note: {
        note_id: "66f0bb22000000001e02b222",
        display_title: "vlog 记录",
        type: "video",
        user: { nickname: "阿抖" },
        interact_info: { liked_count: 999 },
      },
    },
  ],
};

describe("extractXhsNotes", () => {
  it("collects note-shaped objects wherever they nest", () => {
    const notes = extractXhsNotes(XHS_PAYLOAD);
    expect(notes).toHaveLength(2);
    const first = notes.find((n) => n.id === "66f0aa11000000001e02b111");
    expect(first).toMatchObject({ title: "周末探店", author: "小红薯", liked: 12000, comments: 88, collected: 3400, isVideo: false });
    const second = notes.find((n) => n.id === "66f0bb22000000001e02b222");
    expect(second).toMatchObject({ title: "vlog 记录", liked: 999, isVideo: true });
  });

  it("returns nothing for note-free payloads", () => {
    expect(extractXhsNotes({ message: "ok" })).toEqual([]);
    expect(extractXhsNotes(null)).toEqual([]);
  });

  it("finds pagination tokens", () => {
    expect(extractSearchSession(XHS_PAYLOAD)).toEqual({ searchId: "sid123", searchSessionId: "ssid456" });
  });
});

describe("xiaohongshu_search_notes tool", () => {
  it("asks for configuration when no key is set", async () => {
    const result = await createXhsSearchNotesTool(getUnconfigured).execute({ keyword: "美食" });
    expect(result).toEqual({ content: TIKHUB_NOT_CONFIGURED, isError: true });
  });

  it("rejects empty keywords", async () => {
    const result = await createXhsSearchNotesTool(getConfig).execute({ keyword: "  " });
    expect(result.isError).toBe(true);
  });

  it("formats results and pagination hints", async () => {
    respond({ code: 200, data: XHS_PAYLOAD });
    const result = await createXhsSearchNotesTool(getConfig).execute({ keyword: "探店" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("周末探店");
    expect(result.content).toContain("https://www.xiaohongshu.com/explore/66f0aa11000000001e02b111");
    expect(result.content).toContain("search_id=sid123");
    expect(result.content).toContain("[video]");
  });

  it("falls back to a raw excerpt when nothing note-shaped is found", async () => {
    respond({ code: 200, data: { weird: { shape: true } } });
    const result = await createXhsSearchNotesTool(getConfig).execute({ keyword: "探店" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Raw response excerpt");
  });

  it("drops sort/note types it does not recognize", async () => {
    respond({ code: 200, data: XHS_PAYLOAD });
    await createXhsSearchNotesTool(getConfig).execute({ keyword: "探店", sort_type: "bogus", note_type: "bogus" });
    const url = requestUrlMock.mock.calls[0][0].url as string;
    expect(url).not.toContain("sort_type");
    expect(url).not.toContain("note_type");
  });
});
