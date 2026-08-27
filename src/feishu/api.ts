import { requestUrl } from "obsidian";

/**
 * Feishu open-platform document APIs used by the bundled tools. Unlike the
 * OAuth endpoints these are publicly documented; request/response shapes
 * were additionally verified live on 2026-08-27.
 */

const OPEN_BASE = "https://open.feishu.cn";

export class FeishuApiError extends Error {
  constructor(
    message: string,
    /** Feishu business error code (non-zero), or HTTP status when no body. */
    readonly code: number,
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}

interface FeishuEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

async function callApi<T>(accessToken: string, path: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const resp = await requestUrl({
    url: `${OPEN_BASE}${path}`,
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    contentType: init?.json === undefined ? undefined : "application/json",
    body: init?.json === undefined ? undefined : JSON.stringify(init.json),
    throw: false,
  });
  let envelope: FeishuEnvelope<T>;
  try {
    envelope = JSON.parse(resp.text) as FeishuEnvelope<T>;
  } catch {
    throw new FeishuApiError(`Feishu API returned HTTP ${resp.status} with a non-JSON body.`, resp.status);
  }
  if (envelope.code !== 0) {
    throw new FeishuApiError(envelope.msg || `Feishu API error ${envelope.code ?? resp.status}.`, envelope.code ?? resp.status);
  }
  return envelope.data as T;
}

// --- Document reference parsing ---

export type FeishuDocRef =
  | { kind: "docx" | "wiki"; token: string }
  /** A bare token whose type is unknown until tried against the docx API. */
  | { kind: "token"; token: string }
  | { kind: "unsupported"; pathType: string }
  | { kind: "invalid" };

const TOKEN_PATTERN = /^[A-Za-z0-9]{16,64}$/;

/**
 * Accepts a full Feishu/Lark cloud-document URL or a bare document token.
 * URL forms: https://<tenant>.feishu.cn/docx/<token>, .../wiki/<token>;
 * other document kinds (sheets, base, legacy docs, …) parse as unsupported
 * so the caller can say why instead of failing with an opaque API error.
 */
export function parseFeishuDocRef(input: string): FeishuDocRef {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "invalid" };

  if (!/^https?:\/\//i.test(trimmed)) {
    return TOKEN_PATTERN.test(trimmed) ? { kind: "token", token: trimmed } : { kind: "invalid" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "invalid" };
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return { kind: "invalid" };
  const [pathType, token] = segments.slice(-2);
  if (!TOKEN_PATTERN.test(token)) return { kind: "invalid" };
  if (pathType === "docx" || pathType === "wiki") return { kind: pathType, token };
  return { kind: "unsupported", pathType };
}

// --- Wiki node resolution ---

interface WikiNodeData {
  node?: { obj_token?: string; obj_type?: string; title?: string };
}

/** Resolves a wiki node token to the underlying document token and type. */
export async function resolveWikiNode(accessToken: string, nodeToken: string): Promise<{ objToken: string; objType: string }> {
  const data = await callApi<WikiNodeData>(accessToken, `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`);
  const objToken = data.node?.obj_token ?? "";
  const objType = data.node?.obj_type ?? "";
  if (!objToken) throw new FeishuApiError("Wiki node has no underlying document.", 0);
  return { objToken, objType };
}

// --- Document content ---

/** Returns the plain-text content of a new-format (docx) document. */
export async function readDocxRawContent(accessToken: string, documentId: string): Promise<string> {
  const data = await callApi<{ content?: string }>(accessToken, `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`);
  return data.content ?? "";
}

// --- Search ---

export interface DocsSearchEntity {
  docs_token: string;
  docs_type: string;
  title: string;
  owner_id: string;
}

export interface DocsSearchResult {
  entities: DocsSearchEntity[];
  hasMore: boolean;
  total: number;
}

/** Searches the user's cloud documents by keyword. */
export async function searchDocs(accessToken: string, query: string, count: number, offset = 0): Promise<DocsSearchResult> {
  const data = await callApi<{ docs_entities?: DocsSearchEntity[]; has_more?: boolean; total?: number }>(
    accessToken,
    "/open-apis/suite/docs-api/search/object",
    { method: "POST", json: { search_key: query, count, offset } },
  );
  return {
    entities: data.docs_entities ?? [],
    hasMore: data.has_more ?? false,
    total: data.total ?? 0,
  };
}
