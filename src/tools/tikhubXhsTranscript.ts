import { requestUrl } from "obsidian";

import type { RegisteredTool } from "@/core/types";
import { DashScopeApiError, transcribeAudioUrl } from "@/dashscope/api";
import { SiliconFlowApiError, transcribeAudio } from "@/siliconflow/api";
import { fetchXhsNoteDetail, parseXhsNoteRef } from "@/tikhub/api";
import type { TikHubConfigGetter } from "@/tikhub/api";
import { rawFallback, TIKHUB_NOT_CONFIGURED, tikhubErrorResult } from "./tikhubDouyinVideo";
import { findXhsNoteDetail } from "./tikhubXhsNote";

interface XhsGetTranscriptInput {
  url_or_id: string;
}

/** Speech-to-text keys: DashScope (paid, primary) with SiliconFlow (free) as fallback. */
export interface AsrKeys {
  dashscopeApiKey: string;
  siliconflowApiKey: string;
}

export type AsrKeysGetter = () => AsrKeys;

export const ASR_NOT_CONFIGURED =
  "Speech-to-text is not configured. Ask the user to open the plugin settings and enter an Aliyun Bailian " +
  "(DashScope) API key (recommended; created at bailian.console.aliyun.com, billed per audio duration) " +
  "or a SiliconFlow API key (free tier; created at cloud.siliconflow.cn, may be overloaded at peak times).";

/**
 * A note's audio lives in native_voice_info: the "original sound" (原声)
 * attached to a video note. Its absence means an image note, or a video
 * whose only audio is licensed library music (which has no url here either
 * way — nothing worth transcribing).
 */
export interface XhsVoiceInfo {
  url: string;
  /** The sound's display name, e.g. "xxx创作的原声" — lets the model spot library music. */
  name: string;
  durationMs: number;
}

type Dict = Record<string, unknown>;

export function extractXhsVoiceInfo(note: Dict): XhsVoiceInfo | null {
  const voice = note.native_voice_info;
  if (voice === null || typeof voice !== "object" || Array.isArray(voice)) return null;
  const info = voice as Dict;
  const url = typeof info.url === "string" ? info.url : "";
  if (!url) return null;
  return {
    url,
    name: typeof info.name === "string" ? info.name : "",
    durationMs: typeof info.duration === "number" && Number.isFinite(info.duration) ? info.duration : 0,
  };
}

/** ~20 min of AAC; keeps the WebView from buffering huge files in memory. */
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

const MAX_TRANSCRIPT_CHARS = 20000;

/**
 * The CDN serves both schemes but the API reports http://; Android WebViews
 * commonly block cleartext requests, so upgrade and keep the original as a
 * fallback for any region where the https endpoint misbehaves.
 */
async function downloadAudio(url: string): Promise<ArrayBuffer> {
  const candidates = url.startsWith("http://") ? [url.replace(/^http:\/\//, "https://"), url] : [url];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const resp = await requestUrl({ url: candidate, throw: false });
      if (resp.status === 200 && resp.arrayBuffer.byteLength > 0) return resp.arrayBuffer;
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`audio download failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Downloads the audio on the phone and runs it through SiliconFlow's free ASR. */
async function transcribeViaSiliconFlow(apiKey: string, audioUrl: string): Promise<string> {
  const audio = await downloadAudio(audioUrl);
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(`the audio track is too large to transcribe on a phone (${Math.round(audio.byteLength / 1024 / 1024)} MB, limit 30 MB)`);
  }
  return transcribeAudio(apiKey, audio, "audio.m4a", "audio/mp4");
}

export function createXhsGetTranscriptTool(getConfig: TikHubConfigGetter, getAsrKeys: AsrKeysGetter): RegisteredTool {
  return {
    definition: {
      name: "xiaohongshu_get_transcript",
      description:
        "Transcribe the narration of a Xiaohongshu (小红书) video note: fetches the note's original-sound " +
        "audio track via TikHub and runs speech-to-text on it, returning the full spoken transcript. " +
        "Use this when the user wants the actual content of a video (analysis, summary, script breakdown) — " +
        "video notes carry almost no text in their description. Only works for video notes that use their " +
        "own original sound; image notes and music-only videos have nothing to transcribe. " +
        "Accepts a note id, a xiaohongshu.com note URL, or a full share text copied from the app. " +
        "Each call costs the user a TikHub request fee plus a per-audio-duration transcription fee.",
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
      const { url_or_id } = rawInput as XhsGetTranscriptInput;
      const config = getConfig();
      if (!config.apiKey) return { content: TIKHUB_NOT_CONFIGURED, isError: true };
      const keys = getAsrKeys();
      if (!keys.dashscopeApiKey && !keys.siliconflowApiKey) return { content: ASR_NOT_CONFIGURED, isError: true };
      const ref = parseXhsNoteRef(url_or_id ?? "");
      if (ref.kind === "invalid") {
        return { content: `"${url_or_id}" contains neither a Xiaohongshu note link nor a note id.`, isError: true };
      }

      let note: Dict | null;
      try {
        const data = await fetchXhsNoteDetail(config, ref.kind === "id" ? { noteId: ref.noteId } : { shareText: ref.url });
        note = findXhsNoteDetail(data, ref.kind === "id" ? ref.noteId : null);
        if (!note) {
          return {
            content: rawFallback("The requested note was not in the response (it may be deleted or private).", data),
            isError: true,
          };
        }
      } catch (err) {
        return tikhubErrorResult(err);
      }

      const voice = extractXhsVoiceInfo(note);
      if (!voice) {
        const type = typeof note.type === "string" ? note.type : "";
        const reason =
          type === "video"
            ? "This video note has no original-sound audio track (it likely uses licensed background music only)."
            : "This is an image note, not a video — there is no audio to transcribe.";
        return { content: `${reason} Use xiaohongshu_get_note to read its text content instead.`, isError: true };
      }
      const audioUrl = voice.url.replace(/^http:\/\//, "https://");

      let transcript: string | null = null;
      let dashscopeError: string | null = null;
      if (keys.dashscopeApiKey) {
        try {
          transcript = await transcribeAudioUrl(keys.dashscopeApiKey, audioUrl);
        } catch (err) {
          dashscopeError = err instanceof DashScopeApiError ? err.message : `DashScope transcription failed: ${err instanceof Error ? err.message : String(err)}`;
          if (!keys.siliconflowApiKey) return { content: dashscopeError, isError: true };
        }
      }
      if (transcript === null) {
        try {
          transcript = await transcribeViaSiliconFlow(keys.siliconflowApiKey, voice.url);
        } catch (err) {
          const detail = err instanceof SiliconFlowApiError ? err.message : `Transcription failed: ${err instanceof Error ? err.message : String(err)}`;
          const content = dashscopeError ? `${dashscopeError} The SiliconFlow fallback also failed: ${detail}` : detail;
          return { content, isError: true };
        }
      }

      const lines: string[] = [];
      const title = typeof note.title === "string" ? note.title : "";
      if (title) lines.push(`Title: ${title}`);
      if (voice.name) lines.push(`Audio track: ${voice.name}`);
      if (voice.durationMs > 0) lines.push(`Duration: ${Math.round(voice.durationMs / 1000)}s`);
      if (dashscopeError) lines.push(`(DashScope failed — this transcript came from the SiliconFlow fallback: ${dashscopeError})`);
      const trimmed = transcript.trim();
      const capped = trimmed.length > MAX_TRANSCRIPT_CHARS ? trimmed.slice(0, MAX_TRANSCRIPT_CHARS) + "…(truncated)" : trimmed;
      lines.push("", "Transcript (machine speech-to-text; expect occasional mis-heard words):", capped || "(The audio contained no recognizable speech.)");
      return { content: lines.join("\n") };
    },
  };
}
