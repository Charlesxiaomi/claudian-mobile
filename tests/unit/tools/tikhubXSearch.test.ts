import { requestUrl } from "obsidian";

import { DEFAULT_TIKHUB_BASE_URL } from "@/tikhub/api";
import { TIKHUB_NOT_CONFIGURED } from "@/tools/tikhubDouyinVideo";
import { createXSearchTool, extractXTweets } from "@/tools/tikhubXSearch";

const requestUrlMock = requestUrl as jest.Mock;

const getConfig = () => ({ apiKey: "tk-test", baseUrl: DEFAULT_TIKHUB_BASE_URL });

function respond(body: unknown, status = 200): void {
  requestUrlMock.mockResolvedValueOnce({ status, text: JSON.stringify(body) });
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

// Mirrors the live fetch_search_timeline shape from 2026-08-29.
const X_PAYLOAD = {
  status: "ok",
  next_cursor: "DAACCgACHQ3",
  prev_cursor: "DAADDAABCgA",
  timeline: [
    {
      type: "tweet",
      tweet_id: "2091880711234183426",
      screen_name: "RishiUvaach",
      text: "There are two kinds of people in the AI era.\nOne opens Claude Code and builds.",
      created_at: "Mon Aug 24 13:30:01 +0000 2026",
      favorites: 276,
      retweets: 77,
      replies: 49,
      views: "13950",
      user_info: { name: "Rishi", screen_name: "RishiUvaach", followers_count: 15590 },
      media: { video: [{ media_url_https: "https://pbs.twimg.com/x.jpg" }] },
    },
    { type: "cursor", value: "ignore-me" },
    {
      type: "tweet",
      tweet_id: "2091880711234183427",
      screen_name: "someone",
      text: "Short one.",
      created_at: "not a date",
      favorites: 1,
      user_info: { name: "Some One" },
      media: {},
    },
  ],
};

describe("extractXTweets", () => {
  it("keeps tweet items and skips the rest", () => {
    const tweets = extractXTweets(X_PAYLOAD);
    expect(tweets).toHaveLength(2);
    expect(tweets[0]).toMatchObject({
      screenName: "RishiUvaach",
      authorName: "Rishi",
      followers: 15590,
      favorites: 276,
      views: 13950,
      createdAt: "2026-08-24",
      hasMedia: true,
    });
    expect(tweets[1]).toMatchObject({ createdAt: "not a date", hasMedia: false });
  });

  it("returns nothing for timeline-free payloads", () => {
    expect(extractXTweets({ status: "ok" })).toEqual([]);
    expect(extractXTweets(null)).toEqual([]);
  });
});

describe("x_search tool", () => {
  it("asks for configuration when no key is set", async () => {
    const result = await createXSearchTool(() => ({ apiKey: "", baseUrl: DEFAULT_TIKHUB_BASE_URL })).execute({ keyword: "claude" });
    expect(result).toEqual({ content: TIKHUB_NOT_CONFIGURED, isError: true });
  });

  it("formats posts with links and the pagination cursor", async () => {
    respond({ code: 200, data: X_PAYLOAD });
    const result = await createXSearchTool(getConfig).execute({ keyword: "Claude AI", search_type: "Latest" });
    const url = requestUrlMock.mock.calls[0][0].url as string;
    expect(url).toContain("fetch_search_timeline?");
    expect(url).toContain("keyword=Claude%20AI");
    expect(url).toContain("search_type=Latest");
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("@RishiUvaach (Rishi, 15590 followers)");
    expect(result.content).toContain("[media]");
    expect(result.content).toContain("https://x.com/RishiUvaach/status/2091880711234183426");
    expect(result.content).toContain("cursor=DAACCgACHQ3");
  });

  it("falls back to a raw excerpt when nothing tweet-shaped is found", async () => {
    respond({ code: 200, data: { status: "ok", timeline: [{ type: "user", screen_name: "abc" }] } });
    const result = await createXSearchTool(getConfig).execute({ keyword: "claude", search_type: "People" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Raw response excerpt");
  });
});
