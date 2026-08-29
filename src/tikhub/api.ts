import { requestUrl } from "obsidian";

/**
 * TikHub (tikhub.io) social-media data API. One bearer token covers every
 * platform; every response is wrapped in a `{code, message, data}` envelope
 * where code 200 means success. The `data` payload shapes are not part of
 * TikHub's OpenAPI spec, so callers must parse them defensively.
 */

export const DEFAULT_TIKHUB_BASE_URL = "https://api.tikhub.io";

/** Read from settings on every call so key/URL edits apply immediately. */
export interface TikHubConfig {
  apiKey: string;
  baseUrl: string;
}

export type TikHubConfigGetter = () => TikHubConfig;

export class TikHubApiError extends Error {
  constructor(
    message: string,
    /** TikHub envelope code, or HTTP status when the body was unusable. */
    readonly code: number,
  ) {
    super(message);
    this.name = "TikHubApiError";
  }
}

interface TikHubEnvelope {
  code?: number;
  message?: string;
  message_zh?: string;
  data?: unknown;
}

type QueryParams = Record<string, string | number | boolean | undefined>;

/** The same API is served on both domains; .dev is reachable from mainland
 * China where .io may not be, and vice versa for some networks abroad. */
const SIBLING_BASE: Record<string, string> = {
  "https://api.tikhub.io": "https://api.tikhub.dev",
  "https://api.tikhub.dev": "https://api.tikhub.io",
};

export async function callTikHub(config: TikHubConfig, path: string, params: QueryParams): Promise<unknown> {
  const base = (config.baseUrl.trim() || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  try {
    return await callTikHubBase(base, config.apiKey, path, params);
  } catch (err) {
    // API-level failures are final; only a network-level failure (requestUrl
    // threw before producing a response) is worth retrying on the sibling
    // domain, so users never have to think about which one their network can
    // reach.
    const sibling = SIBLING_BASE[base];
    if (err instanceof TikHubApiError || !sibling) throw err;
    return callTikHubBase(sibling, config.apiKey, path, params);
  }
}

async function callTikHubBase(base: string, apiKey: string, path: string, params: QueryParams): Promise<unknown> {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  const resp = await requestUrl({
    url: `${base}${path}${query ? "?" + query : ""}`,
    headers: { Authorization: `Bearer ${apiKey}` },
    throw: false,
  });
  let envelope: TikHubEnvelope;
  try {
    envelope = JSON.parse(resp.text) as TikHubEnvelope;
  } catch {
    throw new TikHubApiError(`TikHub returned HTTP ${resp.status} with a non-JSON body.`, resp.status);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new TikHubApiError("TikHub rejected the API key (unauthorized). Ask the user to check it in settings.", resp.status);
  }
  const code = envelope.code ?? resp.status;
  if (code !== 200) {
    throw new TikHubApiError(envelope.message || envelope.message_zh || `TikHub API error ${code}.`, code);
  }
  return envelope.data;
}

// --- Douyin video reference parsing ---

export type DouyinVideoRef =
  | { kind: "id"; awemeId: string }
  /** A douyin.com URL whose id must be resolved server-side (short links). */
  | { kind: "share_url"; url: string }
  | { kind: "invalid" };

/**
 * Accepts a bare aweme id, a douyin.com URL, or a full share text as copied
 * from the app ("8.23 复制打开抖音... https://v.douyin.com/xxx/ ...").
 * Long-form URLs carry the id and skip a server-side resolution round-trip.
 */
export function parseDouyinVideoRef(input: string): DouyinVideoRef {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "invalid" };
  if (/^\d{5,}$/.test(trimmed)) return { kind: "id", awemeId: trimmed };
  const urlMatch = trimmed.match(/https?:\/\/[^\s，。,]*douyin\.com[^\s，。,]*/i);
  if (!urlMatch) return { kind: "invalid" };
  const url = urlMatch[0].replace(/[)）】"'`；;]+$/, "");
  const idMatch = url.match(/\/(?:video|note)\/(\d+)/) ?? url.match(/[?&]modal_id=(\d+)/);
  if (idMatch) return { kind: "id", awemeId: idMatch[1] };
  return { kind: "share_url", url };
}

// --- Endpoints ---

export async function fetchDouyinVideo(config: TikHubConfig, awemeId: string): Promise<unknown> {
  return callTikHub(config, "/api/v1/douyin/web/fetch_one_video", { aweme_id: awemeId });
}

export async function fetchDouyinVideoByShareUrl(config: TikHubConfig, shareUrl: string): Promise<unknown> {
  return callTikHub(config, "/api/v1/douyin/web/fetch_one_video_by_share_url", { share_url: shareUrl });
}

// --- Xiaohongshu note reference parsing ---

export type XhsNoteRef =
  | { kind: "id"; noteId: string }
  /** A short link (xhslink) whose id must be resolved server-side. */
  | { kind: "share"; url: string }
  | { kind: "invalid" };

const XHS_NOTE_ID = /^[0-9a-f]{24}$/i;

/**
 * Accepts a bare note id, a xiaohongshu.com note URL, or a full share text
 * as copied from the app (which wraps an xhslink.com short link in noise).
 */
export function parseXhsNoteRef(input: string): XhsNoteRef {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "invalid" };
  if (XHS_NOTE_ID.test(trimmed)) return { kind: "id", noteId: trimmed.toLowerCase() };
  const urlMatch = trimmed.match(/https?:\/\/[^\s，。,]*(?:xiaohongshu\.com|xhslink\.(?:com|cn))[^\s，。,]*/i);
  if (!urlMatch) return { kind: "invalid" };
  const url = urlMatch[0].replace(/[)）】"'`；;]+$/, "");
  const idMatch = url.match(/\/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/i);
  if (idMatch) return { kind: "id", noteId: idMatch[1].toLowerCase() };
  return { kind: "share", url };
}

/**
 * Fetches one note's full content. Despite the name, this endpoint returns
 * both image and video notes correctly (verified live 2026-08-29); its
 * video twin returns unrelated recommendations for image notes, so it is
 * deliberately not used.
 */
export async function fetchXhsNoteDetail(config: TikHubConfig, ref: { noteId?: string; shareText?: string }): Promise<unknown> {
  return callTikHub(config, "/api/v1/xiaohongshu/app_v2/get_image_note_detail", {
    note_id: ref.noteId,
    share_text: ref.shareText,
  });
}

export interface XhsSearchOptions {
  keyword: string;
  page?: number;
  sortType?: string;
  noteType?: string;
  searchId?: string;
  searchSessionId?: string;
}

export const X_SEARCH_TYPES = ["Top", "Latest", "Media", "People", "Lists"];

export async function searchXTimeline(config: TikHubConfig, keyword: string, searchType?: string, cursor?: string): Promise<unknown> {
  return callTikHub(config, "/api/v1/twitter/web/fetch_search_timeline", {
    keyword,
    search_type: searchType,
    cursor,
  });
}

export async function searchXhsNotes(config: TikHubConfig, options: XhsSearchOptions): Promise<unknown> {
  return callTikHub(config, "/api/v1/xiaohongshu/app_v2/search_notes", {
    keyword: options.keyword,
    page: options.page,
    sort_type: options.sortType,
    note_type: options.noteType,
    search_id: options.searchId,
    search_session_id: options.searchSessionId,
  });
}
