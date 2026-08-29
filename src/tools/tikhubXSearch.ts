import type { RegisteredTool } from "@/core/types";
import { searchXTimeline, X_SEARCH_TYPES } from "@/tikhub/api";
import type { TikHubConfigGetter } from "@/tikhub/api";
import { rawFallback, TIKHUB_NOT_CONFIGURED, tikhubErrorResult } from "./tikhubDouyinVideo";

interface XSearchInput {
  keyword: string;
  search_type?: string;
  cursor?: string;
}

const MAX_TWEETS = 20;
const MAX_TEXT_CHARS = 600;

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** X counts arrive as numbers or numeric strings (views in particular). */
function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export interface XTweetSummary {
  tweetId: string;
  screenName: string;
  authorName: string;
  followers: number | null;
  text: string;
  createdAt: string;
  favorites: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  hasMedia: boolean;
}

/**
 * TikHub pre-flattens X's timeline into data.timeline[] items with
 * type "tweet" (verified live 2026-08-29); non-tweet items (People/Lists
 * searches) are skipped and covered by the caller's raw fallback.
 */
export function extractXTweets(data: unknown): XTweetSummary[] {
  const timeline = asDict(data)?.timeline;
  if (!Array.isArray(timeline)) return [];
  const tweets: XTweetSummary[] = [];
  for (const item of timeline) {
    const dict = asDict(item);
    if (!dict || dict.type !== "tweet") continue;
    const user = asDict(dict.user_info);
    const media = asDict(dict.media);
    tweets.push({
      tweetId: str(dict.tweet_id),
      screenName: str(dict.screen_name) || str(user?.screen_name),
      authorName: str(user?.name),
      followers: count(user?.followers_count),
      text: str(dict.text).trim(),
      createdAt: formatXDate(str(dict.created_at)),
      favorites: count(dict.favorites),
      retweets: count(dict.retweets),
      replies: count(dict.replies),
      views: count(dict.views),
      hasMedia: Object.values(media ?? {}).some((v) => Array.isArray(v) && v.length > 0),
    });
    if (tweets.length >= MAX_TWEETS) break;
  }
  return tweets;
}

/** "Mon Aug 24 13:30:01 +0000 2026" → "2026-08-24"; raw string if unparseable. */
function formatXDate(raw: string): string {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

export function formatXTweets(tweets: XTweetSummary[]): string {
  return tweets
    .map((tweet, i) => {
      const author = `@${tweet.screenName || "unknown"}${tweet.authorName ? ` (${tweet.authorName}${tweet.followers !== null ? `, ${tweet.followers} followers` : ""})` : ""}`;
      const counts: string[] = [];
      if (tweet.favorites !== null) counts.push(`${tweet.favorites} likes`);
      if (tweet.retweets !== null) counts.push(`${tweet.retweets} retweets`);
      if (tweet.replies !== null) counts.push(`${tweet.replies} replies`);
      if (tweet.views !== null) counts.push(`${tweet.views} views`);
      const text = tweet.text.length > MAX_TEXT_CHARS ? tweet.text.slice(0, MAX_TEXT_CHARS) + "…(truncated)" : tweet.text;
      const parts = [
        `${i + 1}. ${author} · ${tweet.createdAt}${tweet.hasMedia ? " [media]" : ""}`,
        text ? `   ${text.replace(/\n/g, "\n   ")}` : "",
        counts.length ? `   ${counts.join(", ")}` : "",
        tweet.tweetId && tweet.screenName ? `   https://x.com/${tweet.screenName}/status/${tweet.tweetId}` : "",
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n");
}

export function createXSearchTool(getConfig: TikHubConfigGetter): RegisteredTool {
  return {
    definition: {
      name: "x_search",
      description:
        "Search posts on X (Twitter) by keyword via TikHub. Returns each post's full text, author, " +
        "date, like/retweet/reply/view counts and link. search_type Top (default) ranks by relevance, " +
        "Latest by recency. For the next page, pass back the cursor returned by the previous call. " +
        "Each call costs the user a small pay-per-request fee.",
      input_schema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Search keyword(s); X search operators like from:user are supported." },
          search_type: { type: "string", enum: X_SEARCH_TYPES, description: "Top = relevance (default), Latest = newest first." },
          cursor: { type: "string", description: "From a previous result; required for pagination." },
        },
        required: ["keyword"],
      },
    },
    async execute(rawInput) {
      const input = rawInput as XSearchInput;
      const keyword = (input.keyword ?? "").trim();
      if (!keyword) return { content: "Search keyword must not be empty.", isError: true };
      const config = getConfig();
      if (!config.apiKey) return { content: TIKHUB_NOT_CONFIGURED, isError: true };
      try {
        const data = await searchXTimeline(
          config,
          keyword,
          X_SEARCH_TYPES.includes(input.search_type ?? "") ? input.search_type : undefined,
          input.cursor,
        );
        const tweets = extractXTweets(data);
        if (tweets.length === 0) {
          return { content: rawFallback(`No posts could be parsed out of the response for "${keyword}".`, data) };
        }
        const nextCursor = str(asDict(data)?.next_cursor);
        const header = `Found ${tweets.length} post(s) for "${keyword}":`;
        const footer = nextCursor ? `\nFor the next page pass: cursor=${nextCursor}` : "";
        return { content: `${header}\n${formatXTweets(tweets)}${footer}` };
      } catch (err) {
        return tikhubErrorResult(err);
      }
    },
  };
}
