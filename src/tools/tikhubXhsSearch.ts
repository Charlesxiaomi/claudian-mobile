import type { RegisteredTool } from "@/core/types";
import { searchXhsNotes } from "@/tikhub/api";
import type { TikHubConfigGetter } from "@/tikhub/api";
import { rawFallback, TIKHUB_NOT_CONFIGURED, tikhubErrorResult } from "./tikhubDouyinVideo";

interface XhsSearchInput {
  keyword: string;
  page?: number;
  sort_type?: string;
  note_type?: string;
  search_id?: string;
  search_session_id?: string;
}

const SORT_TYPES = ["general", "time_descending", "popularity_descending", "comment_descending", "collect_descending"];
const NOTE_TYPES = ["不限", "视频笔记", "普通笔记", "直播笔记"];
const MAX_NOTES = 20;

export interface XhsNoteSummary {
  id: string;
  title: string;
  desc: string;
  author: string;
  liked: number | null;
  comments: number | null;
  collected: number | null;
  isVideo: boolean;
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** XHS counts arrive as numbers or as strings like "1.2万". */
function firstCount(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const wan = v.match(/^([\d.]+)\s*[万w]$/i);
      const parsed = wan ? Number(wan[1]) * 10000 : Number(v);
      if (Number.isFinite(parsed)) return Math.round(parsed);
    }
  }
  return null;
}

/**
 * TikHub's Xiaohongshu payload shape is undocumented and version-dependent,
 * so instead of hardcoding a path to the note list, walk the whole payload
 * and collect anything note-shaped: an object with an id plus a title or
 * description. Interaction counts and the author live either inline or in
 * nested `interact_info` / `user` objects depending on the API version.
 */
export function extractXhsNotes(data: unknown): XhsNoteSummary[] {
  const notes = new Map<string, XhsNoteSummary>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 12 || notes.size >= MAX_NOTES * 2) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const dict = asDict(value);
    if (!dict) return;
    const id = firstString(dict.note_id, dict.id);
    const title = firstString(dict.title, dict.display_title);
    const desc = firstString(dict.desc);
    if (/^[0-9a-f]{20,32}$/i.test(id) && (title || desc)) {
      const interact = asDict(dict.interact_info);
      const user = asDict(dict.user) ?? asDict(dict.author);
      const type = firstString(dict.type, dict.note_type, dict.model_type);
      const existing = notes.get(id);
      const summary: XhsNoteSummary = {
        id,
        title: title || (existing?.title ?? ""),
        desc: desc || (existing?.desc ?? ""),
        author: firstString(user?.nickname, user?.name, user?.nick_name) || (existing?.author ?? ""),
        liked: firstCount(interact?.liked_count, dict.liked_count, dict.likes) ?? existing?.liked ?? null,
        comments: firstCount(interact?.comment_count, dict.comments_count, dict.comment_count) ?? existing?.comments ?? null,
        collected: firstCount(interact?.collected_count, dict.collected_count) ?? existing?.collected ?? null,
        isVideo: type === "video" || (existing?.isVideo ?? false),
      };
      notes.set(id, summary);
    }
    for (const child of Object.values(dict)) walk(child, depth + 1);
  };
  walk(data, 0);
  return Array.from(notes.values()).slice(0, MAX_NOTES);
}

/** Pagination tokens the endpoint expects back verbatim on later pages. */
export function extractSearchSession(data: unknown): { searchId: string; searchSessionId: string } {
  let searchId = "";
  let searchSessionId = "";
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || (searchId && searchSessionId)) return;
    if (Array.isArray(value)) return;
    const dict = asDict(value);
    if (!dict) return;
    searchId ||= firstString(dict.search_id);
    searchSessionId ||= firstString(dict.search_session_id);
    for (const child of Object.values(dict)) walk(child, depth + 1);
  };
  walk(data, 0);
  return { searchId, searchSessionId };
}

export function formatXhsNotes(notes: XhsNoteSummary[]): string {
  return notes
    .map((note, i) => {
      const counts: string[] = [];
      if (note.liked !== null) counts.push(`${note.liked} likes`);
      if (note.collected !== null) counts.push(`${note.collected} collects`);
      if (note.comments !== null) counts.push(`${note.comments} comments`);
      const parts = [
        `${i + 1}. ${note.title || "(no title)"}${note.isVideo ? " [video]" : ""}`,
        note.author ? `   by ${note.author}${counts.length ? " · " + counts.join(", ") : ""}` : counts.length ? `   ${counts.join(", ")}` : "",
        note.desc ? `   ${note.desc.slice(0, 120)}` : "",
        `   https://www.xiaohongshu.com/explore/${note.id}`,
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n");
}

export function createXhsSearchNotesTool(getConfig: TikHubConfigGetter): RegisteredTool {
  return {
    definition: {
      name: "xiaohongshu_search_notes",
      description:
        "Search Xiaohongshu (小红书) notes by keyword via TikHub. Returns note titles, authors, " +
        "like/collect/comment counts, a ~60-character content preview and links; to read a result's " +
        "full text, pass its note id to xiaohongshu_get_note. Supports sorting and filtering by note " +
        "type. For page 2+, pass back the search_id and search_session_id returned by the first page. " +
        "Each call costs the user a small pay-per-request fee.",
      input_schema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Search keyword(s), e.g. 美食推荐." },
          page: { type: "number", description: "Page number, starting from 1 (default 1)." },
          sort_type: {
            type: "string",
            enum: SORT_TYPES,
            description: "general = relevance (default), time_descending = newest, popularity_descending = most liked.",
          },
          note_type: {
            type: "string",
            enum: NOTE_TYPES,
            description: "不限 = all (default), 视频笔记 = video only, 普通笔记 = image/text only.",
          },
          search_id: { type: "string", description: "From a previous page's result; required for pagination." },
          search_session_id: { type: "string", description: "From a previous page's result; required for pagination." },
        },
        required: ["keyword"],
      },
    },
    async execute(rawInput) {
      const input = rawInput as XhsSearchInput;
      const keyword = (input.keyword ?? "").trim();
      if (!keyword) return { content: "Search keyword must not be empty.", isError: true };
      const config = getConfig();
      if (!config.apiKey) return { content: TIKHUB_NOT_CONFIGURED, isError: true };
      const page = Math.max(Math.floor(input.page ?? 1), 1);
      try {
        const data = await searchXhsNotes(config, {
          keyword,
          page,
          sortType: SORT_TYPES.includes(input.sort_type ?? "") ? input.sort_type : undefined,
          noteType: NOTE_TYPES.includes(input.note_type ?? "") ? input.note_type : undefined,
          searchId: input.search_id,
          searchSessionId: input.search_session_id,
        });
        const notes = extractXhsNotes(data);
        if (notes.length === 0) {
          return { content: rawFallback(`No notes could be parsed out of the response for "${keyword}" (page ${page}).`, data) };
        }
        const session = extractSearchSession(data);
        const header = `Found ${notes.length} note(s) for "${keyword}" (page ${page}):`;
        const footer = session.searchId
          ? `\nFor the next page pass: page=${page + 1}, search_id=${session.searchId}` +
            (session.searchSessionId ? `, search_session_id=${session.searchSessionId}` : "")
          : "";
        return { content: `${header}\n${formatXhsNotes(notes)}${footer}` };
      } catch (err) {
        return tikhubErrorResult(err);
      }
    },
  };
}
