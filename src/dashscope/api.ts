import { requestUrl } from "obsidian";

/**
 * Aliyun Bailian / DashScope (dashscope.aliyuncs.com) — used only for its
 * asynchronous file-transcription ASR endpoint. Unlike SiliconFlow's free
 * tier it is paid and reliable, and it fetches the audio URL server-side,
 * so the phone never has to download the audio at all.
 */

export const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";

export const DASHSCOPE_ASR_MODEL = "qwen-audio-3.0-asr-flash-filetrans";

const POLL_INTERVAL_MS = 3000;

/** File transcription of a few-minute video normally finishes well within this. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export class DashScopeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DashScopeApiError";
  }
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function parseBody(status: number, text: string): Dict {
  try {
    return asDict(JSON.parse(text));
  } catch {
    throw new DashScopeApiError(`DashScope returned HTTP ${status} with a non-JSON body: ${text.slice(0, 200)}`, status);
  }
}

function errorDetail(parsed: Dict, status: number): string {
  const output = asDict(parsed.output);
  const message = [output.message, parsed.message].find((m): m is string => typeof m === "string" && m.length > 0);
  const code = [output.code, parsed.code].find((c): c is string => typeof c === "string" && c.length > 0);
  if (message) return code ? `${code}: ${message}` : message;
  return `HTTP ${status}`;
}

/** Submits an async transcription task for a publicly reachable audio URL. */
export async function submitTranscriptionTask(apiKey: string, audioUrl: string): Promise<string> {
  const resp = await requestUrl({
    url: `${DASHSCOPE_BASE_URL}/api/v1/services/audio/asr/transcription`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: DASHSCOPE_ASR_MODEL,
      input: { file_urls: [audioUrl] },
      parameters: { language_hints: ["zh", "en"] },
    }),
    throw: false,
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new DashScopeApiError("DashScope rejected the API key (unauthorized). Ask the user to check it in settings.", resp.status);
  }
  const parsed = parseBody(resp.status, resp.text);
  const taskId = asDict(parsed.output).task_id;
  if (resp.status !== 200 || typeof taskId !== "string" || !taskId) {
    throw new DashScopeApiError(`DashScope task submission failed: ${errorDetail(parsed, resp.status)}`, resp.status);
  }
  return taskId;
}

async function fetchTask(apiKey: string, taskId: string): Promise<Dict> {
  const resp = await requestUrl({
    url: `${DASHSCOPE_BASE_URL}/api/v1/tasks/${taskId}`,
    headers: { Authorization: `Bearer ${apiKey}` },
    throw: false,
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new DashScopeApiError("DashScope rejected the API key (unauthorized). Ask the user to check it in settings.", resp.status);
  }
  const parsed = parseBody(resp.status, resp.text);
  if (resp.status !== 200) {
    throw new DashScopeApiError(`DashScope task query failed: ${errorDetail(parsed, resp.status)}`, resp.status);
  }
  return parsed;
}

/**
 * A finished task does not carry the text inline; it points at a JSON file
 * (on public OSS, valid for 24h) whose transcripts[].text holds the result.
 */
async function downloadTranscript(taskEnvelope: Dict): Promise<string> {
  const output = asDict(taskEnvelope.output);
  const results = Array.isArray(output.results) ? output.results.map(asDict) : [];
  const failed = results.find((r) => r.subtask_status === "FAILED");
  if (failed) {
    throw new DashScopeApiError(`DashScope transcription failed: ${errorDetail(failed, 200)}`, 200);
  }
  const url = results.map((r) => r.transcription_url).find((u): u is string => typeof u === "string" && u.length > 0);
  if (!url) {
    throw new DashScopeApiError("DashScope task succeeded but returned no transcription_url.", 200);
  }
  const resp = await requestUrl({ url, throw: false });
  if (resp.status !== 200) {
    throw new DashScopeApiError(`Downloading the transcription result failed: HTTP ${resp.status}`, resp.status);
  }
  const parsed = parseBody(resp.status, resp.text);
  const transcripts = Array.isArray(parsed.transcripts) ? parsed.transcripts.map(asDict) : [];
  return transcripts
    .map((t) => (typeof t.text === "string" ? t.text : ""))
    .filter((t) => t.length > 0)
    .join("\n");
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Submits the audio URL, polls until the task settles, and returns the text. */
export async function transcribeAudioUrl(apiKey: string, audioUrl: string, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<string> {
  const taskId = await submitTranscriptionTask(apiKey, audioUrl);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const envelope = await fetchTask(apiKey, taskId);
    const status = asDict(envelope.output).task_status;
    if (status === "SUCCEEDED") return downloadTranscript(envelope);
    if (status === "FAILED" || status === "CANCELED") {
      throw new DashScopeApiError(`DashScope transcription failed: ${errorDetail(envelope, 200)}`, 200);
    }
    if (Date.now() > deadline) {
      throw new DashScopeApiError("DashScope transcription timed out (the task did not finish within 5 minutes).", 200);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
