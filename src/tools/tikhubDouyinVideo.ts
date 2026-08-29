import type { RegisteredTool, ToolExecutionResult } from "@/core/types";
import { fetchDouyinVideo, fetchDouyinVideoByShareUrl, parseDouyinVideoRef, TikHubApiError } from "@/tikhub/api";
import type { TikHubConfigGetter } from "@/tikhub/api";

interface DouyinGetVideoInput {
  url_or_id: string;
}

export const TIKHUB_NOT_CONFIGURED =
  "TikHub is not configured. Ask the user to open the plugin settings and enter a TikHub API key " +
  "(tokens are created at user.tikhub.io; requests are pay-per-use).";

/** Maps TikHub failures to a tool result the model can act on. */
export function tikhubErrorResult(err: unknown): ToolExecutionResult {
  if (err instanceof TikHubApiError) {
    return { content: `TikHub request failed: ${err.message}`, isError: true };
  }
  return { content: `TikHub request failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
}

/** TikHub `data` payloads are undocumented; cap what we echo back verbatim. */
export const RAW_FALLBACK_LIMIT = 4000;

export function rawFallback(intro: string, data: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return `${intro} The response could not be serialized.`;
  }
  const truncated = json.length > RAW_FALLBACK_LIMIT ? json.slice(0, RAW_FALLBACK_LIMIT) + "…(truncated)" : json;
  return `${intro} Raw response excerpt:\n${truncated}`;
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Formats the interesting subset of an aweme_detail; null when unrecognizable. */
export function summarizeDouyinVideo(data: unknown): string | null {
  const root = asDict(data);
  const detail =
    asDict(root?.aweme_detail) ??
    asDict(Array.isArray(root?.aweme_details) ? (root?.aweme_details as unknown[])[0] : null) ??
    asDict(asDict(root?.data)?.aweme_detail);
  if (!detail) return null;

  const author = asDict(detail.author);
  const stats = asDict(detail.statistics);
  const video = asDict(detail.video);
  const lines: string[] = [];

  const desc = str(detail.desc).trim();
  lines.push(`Caption: ${desc || "(none)"}`);
  if (str(detail.aweme_id)) lines.push(`Video id: ${str(detail.aweme_id)}`);
  if (author) {
    const handle = str(author.unique_id) || str(author.short_id);
    lines.push(`Author: ${str(author.nickname) || "(unknown)"}${handle ? ` (@${handle})` : ""}`);
  }
  const createTime = num(detail.create_time);
  if (createTime) lines.push(`Published: ${new Date(createTime * 1000).toISOString()}`);
  const durationMs = num(video?.duration) ?? num(detail.duration);
  if (durationMs) lines.push(`Duration: ${Math.round(durationMs / 1000)}s`);
  const images = Array.isArray(detail.images) ? (detail.images as unknown[]) : [];
  if (images.length > 0) lines.push(`Type: image post (${images.length} image(s))`);
  if (stats) {
    const counts: string[] = [];
    const push = (label: string, value: unknown) => {
      const n = num(value);
      if (n !== null) counts.push(`${label} ${n}`);
    };
    push("likes", stats.digg_count);
    push("comments", stats.comment_count);
    push("collects", stats.collect_count);
    push("shares", stats.share_count);
    // The web API reports play_count as 0 (Douyin hides it); only a real
    // value is worth relaying.
    if ((num(stats.play_count) ?? 0) > 0) push("plays", stats.play_count);
    if (counts.length > 0) lines.push(`Stats: ${counts.join(", ")}`);
  }
  const shareUrl = str(detail.share_url).split("?")[0];
  if (shareUrl) lines.push(`Link: ${shareUrl}`);
  return lines.join("\n");
}

export function createDouyinGetVideoTool(getConfig: TikHubConfigGetter): RegisteredTool {
  return {
    definition: {
      name: "douyin_get_video",
      description:
        "Fetch details of a single Douyin (抖音) video via TikHub: caption, author, publish time, " +
        "like/comment/collect/share counts. Accepts a douyin.com link, a full share text copied from " +
        "the Douyin app (the link inside is extracted automatically), or a bare numeric video id. " +
        "Each call costs the user a small pay-per-request fee.",
      input_schema: {
        type: "object",
        properties: {
          url_or_id: {
            type: "string",
            description: "Douyin video URL, share text containing one, or a bare numeric video id.",
          },
        },
        required: ["url_or_id"],
      },
    },
    async execute(rawInput) {
      const { url_or_id } = rawInput as DouyinGetVideoInput;
      const config = getConfig();
      if (!config.apiKey) return { content: TIKHUB_NOT_CONFIGURED, isError: true };
      const ref = parseDouyinVideoRef(url_or_id ?? "");
      if (ref.kind === "invalid") {
        return { content: `"${url_or_id}" contains neither a douyin.com link nor a numeric video id.`, isError: true };
      }
      try {
        const data = ref.kind === "id" ? await fetchDouyinVideo(config, ref.awemeId) : await fetchDouyinVideoByShareUrl(config, ref.url);
        const summary = summarizeDouyinVideo(data);
        return { content: summary ?? rawFallback("The response had no recognizable video detail.", data) };
      } catch (err) {
        return tikhubErrorResult(err);
      }
    },
  };
}
