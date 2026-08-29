import type { RegisteredTool } from "@/core/types";
import { fetchXhsNoteDetail, parseXhsNoteRef } from "@/tikhub/api";
import type { TikHubConfigGetter } from "@/tikhub/api";
import { rawFallback, TIKHUB_NOT_CONFIGURED, tikhubErrorResult } from "./tikhubDouyinVideo";

interface XhsGetNoteInput {
  url_or_id: string;
}

const MAX_DESC_CHARS = 4000;

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

/**
 * Finds the requested note in the detail payload. The note sits at
 * data[0].note_list[0], but walk the whole payload instead of hardcoding
 * that path. User profiles also carry a 24-hex id, so a candidate must
 * additionally look like a note (interaction counts or a note type); when
 * the requested id is known it must match, guarding against the endpoint
 * answering with recommendations instead of the requested note.
 */
export function findXhsNoteDetail(data: unknown, noteId: string | null): Dict | null {
  const walk = (value: unknown, depth: number): Dict | null => {
    if (depth > 8) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const dict = asDict(value);
    if (!dict) return null;
    const id = str(dict.id).toLowerCase();
    const noteShaped =
      num(dict.liked_count) !== null || num(dict.collected_count) !== null || num(dict.comments_count) !== null || str(dict.type) === "video" || str(dict.type) === "normal";
    if (/^[0-9a-f]{24}$/.test(id) && noteShaped && (str(dict.title) || str(dict.desc)) && (!noteId || id === noteId)) {
      return dict;
    }
    for (const child of Object.values(dict)) {
      const found = walk(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(data, 0);
}

export function summarizeXhsNote(note: Dict): string {
  const user = asDict(note.user);
  const lines: string[] = [];
  lines.push(`Title: ${str(note.title) || "(none)"}`);
  const type = str(note.type);
  if (type) lines.push(`Type: ${type === "video" ? "video note" : "image note"}`);
  const author = str(user?.nickname) || str(user?.name);
  if (author) lines.push(`Author: ${author}`);
  const time = num(note.time);
  if (time) lines.push(`Published: ${new Date(time * 1000).toISOString()}`);
  if (str(note.ip_location)) lines.push(`IP location: ${str(note.ip_location)}`);
  const counts: string[] = [];
  const push = (label: string, value: unknown) => {
    const n = num(value);
    if (n !== null) counts.push(`${label} ${n}`);
  };
  push("likes", note.liked_count);
  push("collects", note.collected_count);
  push("comments", note.comments_count);
  push("shares", note.shared_count);
  if (counts.length > 0) lines.push(`Stats: ${counts.join(", ")}`);
  const images = Array.isArray(note.images_list) ? (note.images_list as unknown[]).length : 0;
  if (type !== "video" && images > 0) lines.push(`Images: ${images}`);
  const id = str(note.id);
  if (id) lines.push(`Link: https://www.xiaohongshu.com/explore/${id}`);
  const desc = str(note.desc).trim();
  const truncated = desc.length > MAX_DESC_CHARS ? desc.slice(0, MAX_DESC_CHARS) + "…(truncated)" : desc;
  lines.push("", "Content:", truncated || "(The note has no text content.)");
  return lines.join("\n");
}

export function createXhsGetNoteTool(getConfig: TikHubConfigGetter): RegisteredTool {
  return {
    definition: {
      name: "xiaohongshu_get_note",
      description:
        "Read the full text content of a single Xiaohongshu (小红书) note via TikHub, plus author, " +
        "publish time and interaction counts. Use this after xiaohongshu_search_notes to read a result " +
        "in full (search only returns ~60-character previews). Accepts a note id from search results, " +
        "a xiaohongshu.com note URL, or a full share text copied from the app. " +
        "Each call costs the user a small pay-per-request fee.",
      input_schema: {
        type: "object",
        properties: {
          url_or_id: {
            type: "string",
            description: "Note id (24 hex chars, from search results), note URL, or share text containing an xhslink.",
          },
        },
        required: ["url_or_id"],
      },
    },
    async execute(rawInput) {
      const { url_or_id } = rawInput as XhsGetNoteInput;
      const config = getConfig();
      if (!config.apiKey) return { content: TIKHUB_NOT_CONFIGURED, isError: true };
      const ref = parseXhsNoteRef(url_or_id ?? "");
      if (ref.kind === "invalid") {
        return { content: `"${url_or_id}" contains neither a Xiaohongshu note link nor a note id.`, isError: true };
      }
      try {
        const data = await fetchXhsNoteDetail(config, ref.kind === "id" ? { noteId: ref.noteId } : { shareText: ref.url });
        const note = findXhsNoteDetail(data, ref.kind === "id" ? ref.noteId : null);
        if (!note) {
          return {
            content: rawFallback("The requested note was not in the response (it may be deleted or private).", data),
            isError: true,
          };
        }
        return { content: summarizeXhsNote(note) };
      } catch (err) {
        return tikhubErrorResult(err);
      }
    },
  };
}
