import { requestUrl } from "obsidian";

/**
 * SiliconFlow (siliconflow.cn) inference API — used only for its
 * OpenAI-compatible speech-to-text endpoint. Chosen because it is reachable
 * from mainland-China networks (where the audio CDN lives too) and priced
 * per audio minute.
 */

export const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn";

export const SILICONFLOW_ASR_MODEL = "FunAudioLLM/SenseVoiceSmall";

export class SiliconFlowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SiliconFlowApiError";
  }
}

/**
 * Builds a multipart/form-data body by hand: Obsidian's requestUrl takes a
 * string or ArrayBuffer body and does not understand FormData, and the
 * mobile WebView offers no other way to attach binary data to it.
 */
export function buildMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  file: { field: string; filename: string; contentType: string; data: ArrayBuffer },
): ArrayBuffer {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(encoder.encode(`--${boundary}\r\n` + `Content-Disposition: form-data; name="${name}"\r\n\r\n` + `${value}\r\n`));
  }
  parts.push(
    encoder.encode(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  parts.push(new Uint8Array(file.data));
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body.buffer;
}

/** Transcribes an audio file (m4a/mp3/wav) and returns the raw text. */
export async function transcribeAudio(apiKey: string, audio: ArrayBuffer, filename: string, contentType: string): Promise<string> {
  const boundary = "----claudian-mobile-" + Math.random().toString(36).slice(2);
  const body = buildMultipartBody(boundary, { model: SILICONFLOW_ASR_MODEL }, { field: "file", filename, contentType, data: audio });
  const resp = await requestUrl({
    url: `${SILICONFLOW_BASE_URL}/v1/audio/transcriptions`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    throw: false,
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new SiliconFlowApiError("SiliconFlow rejected the API key (unauthorized). Ask the user to check it in settings.", resp.status);
  }
  let parsed: { text?: unknown; message?: unknown };
  try {
    parsed = JSON.parse(resp.text) as { text?: unknown; message?: unknown };
  } catch {
    throw new SiliconFlowApiError(`SiliconFlow returned HTTP ${resp.status} with a non-JSON body.`, resp.status);
  }
  if (resp.status !== 200 || typeof parsed.text !== "string") {
    const detail = typeof parsed.message === "string" ? parsed.message : `HTTP ${resp.status}`;
    throw new SiliconFlowApiError(`SiliconFlow transcription failed: ${detail}`, resp.status);
  }
  return parsed.text;
}
