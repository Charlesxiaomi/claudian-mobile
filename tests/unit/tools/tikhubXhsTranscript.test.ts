import { requestUrl } from "obsidian";

import { transcribeAudioUrl } from "@/dashscope/api";
import { buildMultipartBody } from "@/siliconflow/api";
import { DEFAULT_TIKHUB_BASE_URL } from "@/tikhub/api";
import { TIKHUB_NOT_CONFIGURED } from "@/tools/tikhubDouyinVideo";
import { ASR_NOT_CONFIGURED, createXhsGetTranscriptTool, extractXhsVoiceInfo } from "@/tools/tikhubXhsTranscript";

const requestUrlMock = requestUrl as jest.Mock;

const getConfig = () => ({ apiKey: "tk-test", baseUrl: DEFAULT_TIKHUB_BASE_URL });
const bothKeys = () => ({ dashscopeApiKey: "ds-test", siliconflowApiKey: "sk-asr-test" });
const siliconflowOnly = () => ({ dashscopeApiKey: "", siliconflowApiKey: "sk-asr-test" });
const dashscopeOnly = () => ({ dashscopeApiKey: "ds-test", siliconflowApiKey: "" });

beforeEach(() => {
  requestUrlMock.mockReset();
});

const NOTE_ID = "6a8ed06f000000002003a3a3";
const AUDIO_URL = "http://sns-v8.rednotecdn.com/audio/1/abc_0.m4a?sign=x";
const TRANSCRIPTION_URL = "https://oss-result.example.com/result.json";

function videoNotePayload(noteOverrides: Record<string, unknown> = {}): unknown {
  // Outer envelope is TikHub's ({code: 200}); the inner data mirrors the
  // Xiaohongshu payload where the note nests under data[0].note_list[0].
  return {
    code: 200,
    data: {
      data: [
        {
          model_type: "note",
          note_list: [
            {
              id: NOTE_ID,
              type: "video",
              title: "5 分钟讲清楚素材、争点、议程、选题",
              desc: "为什么我不再区分泛流量和精准流量",
              liked_count: 71,
              native_voice_info: {
                name: "dontbesilent 的原声",
                duration: 313353,
                url: AUDIO_URL,
              },
              ...noteOverrides,
            },
          ],
        },
      ],
    },
  };
}

function submitResponse(taskId = "task-1"): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ output: { task_id: taskId, task_status: "PENDING" } }) };
}

function taskResponse(taskStatus: string, results?: unknown[]): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ output: { task_id: "task-1", task_status: taskStatus, results } }) };
}

function transcriptFile(text: string): { status: number; text: string } {
  return { status: 200, text: JSON.stringify({ transcripts: [{ channel_id: 0, text }] }) };
}

describe("extractXhsVoiceInfo", () => {
  it("pulls url, name and duration from native_voice_info", () => {
    const note = { native_voice_info: { url: AUDIO_URL, name: "原声", duration: 1000 } };
    expect(extractXhsVoiceInfo(note)).toEqual({ url: AUDIO_URL, name: "原声", durationMs: 1000 });
  });

  it("returns null when the block is missing or has no url", () => {
    expect(extractXhsVoiceInfo({})).toBeNull();
    expect(extractXhsVoiceInfo({ native_voice_info: { name: "配乐" } })).toBeNull();
    expect(extractXhsVoiceInfo({ native_voice_info: "oops" })).toBeNull();
  });
});

describe("buildMultipartBody", () => {
  it("encodes fields and the file between boundaries", () => {
    const audio = new TextEncoder().encode("AUDIO").buffer;
    const body = buildMultipartBody("BOUND", { model: "m1" }, { field: "file", filename: "a.m4a", contentType: "audio/mp4", data: audio });
    const text = new TextDecoder().decode(body);
    expect(text).toContain('name="model"\r\n\r\nm1');
    expect(text).toContain('name="file"; filename="a.m4a"');
    expect(text).toContain("Content-Type: audio/mp4\r\n\r\nAUDIO");
    expect(text.endsWith("--BOUND--\r\n")).toBe(true);
  });
});

describe("transcribeAudioUrl", () => {
  it("submits, polls until SUCCEEDED and downloads the transcript", async () => {
    requestUrlMock
      .mockResolvedValueOnce(submitResponse())
      .mockResolvedValueOnce(taskResponse("RUNNING"))
      .mockResolvedValueOnce(taskResponse("SUCCEEDED", [{ subtask_status: "SUCCEEDED", transcription_url: TRANSCRIPTION_URL }]))
      .mockResolvedValueOnce(transcriptFile("你好世界。"));

    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(transcribeAudioUrl("ds-test", "https://cdn/a.m4a", sleep)).resolves.toBe("你好世界。");
    expect(sleep).toHaveBeenCalledTimes(1);

    const submitCall = requestUrlMock.mock.calls[0][0] as { url: string; headers: Record<string, string>; body: string };
    expect(submitCall.url).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription");
    expect(submitCall.headers.Authorization).toBe("Bearer ds-test");
    expect(submitCall.headers["X-DashScope-Async"]).toBe("enable");
    expect(JSON.parse(submitCall.body).input.file_urls).toEqual(["https://cdn/a.m4a"]);
    expect((requestUrlMock.mock.calls[1][0] as { url: string }).url).toBe("https://dashscope.aliyuncs.com/api/v1/tasks/task-1");
  });

  it("rejects when the task fails", async () => {
    requestUrlMock
      .mockResolvedValueOnce(submitResponse())
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify({ output: { task_status: "FAILED", code: "InvalidFile", message: "bad audio" } }) });
    await expect(transcribeAudioUrl("ds-test", "https://cdn/a.m4a")).rejects.toThrow("InvalidFile: bad audio");
  });

  it("rejects on an unauthorized submission", async () => {
    requestUrlMock.mockResolvedValueOnce({ status: 401, text: JSON.stringify({ code: "InvalidApiKey", message: "No API-key provided." }) });
    await expect(transcribeAudioUrl("ds-test", "https://cdn/a.m4a")).rejects.toThrow("rejected the API key");
  });
});

describe("xiaohongshu_get_transcript", () => {
  it("reports missing TikHub / speech-to-text keys without making requests", async () => {
    const noTikhub = createXhsGetTranscriptTool(() => ({ apiKey: "", baseUrl: DEFAULT_TIKHUB_BASE_URL }), bothKeys);
    expect(await noTikhub.execute({ url_or_id: NOTE_ID })).toEqual({ content: TIKHUB_NOT_CONFIGURED, isError: true });
    const noAsr = createXhsGetTranscriptTool(getConfig, () => ({ dashscopeApiKey: "", siliconflowApiKey: "" }));
    expect(await noAsr.execute({ url_or_id: NOTE_ID })).toEqual({ content: ASR_NOT_CONFIGURED, isError: true });
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("rejects inputs without a note reference", async () => {
    const tool = createXhsGetTranscriptTool(getConfig, bothKeys);
    const result = await tool.execute({ url_or_id: "not a note" });
    expect(result.isError).toBe(true);
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it("transcribes through DashScope by submitting the https audio url", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockResolvedValueOnce(submitResponse())
      .mockResolvedValueOnce(taskResponse("SUCCEEDED", [{ subtask_status: "SUCCEEDED", transcription_url: TRANSCRIPTION_URL }]))
      .mockResolvedValueOnce(transcriptFile("素材产生多个争点。"));

    const tool = createXhsGetTranscriptTool(getConfig, bothKeys);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Title: 5 分钟讲清楚素材、争点、议程、选题");
    expect(result.content).toContain("Duration: 313s");
    expect(result.content).toContain("素材产生多个争点。");

    // DashScope fetches the audio itself; the cleartext CDN URL is upgraded to https.
    const submitCall = requestUrlMock.mock.calls[1][0] as { body: string };
    expect(JSON.parse(submitCall.body).input.file_urls).toEqual([AUDIO_URL.replace("http://", "https://")]);
  });

  it("falls back to SiliconFlow when DashScope fails and labels the result", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockResolvedValueOnce({ status: 503, text: "<html>gateway error</html>" })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: new Uint8Array([1, 2, 3]).buffer })
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify({ text: "备用通道转写。" }) });

    const tool = createXhsGetTranscriptTool(getConfig, bothKeys);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("备用通道转写。");
    expect(result.content).toContain("SiliconFlow fallback");

    const asrCall = requestUrlMock.mock.calls[3][0] as { url: string };
    expect(asrCall.url).toBe("https://api.siliconflow.cn/v1/audio/transcriptions");
  });

  it("surfaces the DashScope error directly when no fallback key is set", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockResolvedValueOnce({ status: 503, text: "<html>gateway error</html>" });

    const tool = createXhsGetTranscriptTool(getConfig, dashscopeOnly);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("HTTP 503");
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });

  it("reports both errors when DashScope and the fallback both fail", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockResolvedValueOnce({ status: 503, text: "<html>gateway error</html>" })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: new Uint8Array([1]).buffer })
      .mockResolvedValueOnce({ status: 503, text: "<html>overloaded</html>" });

    const tool = createXhsGetTranscriptTool(getConfig, bothKeys);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("DashScope");
    expect(result.content).toContain("SiliconFlow fallback also failed");
  });

  it("uses SiliconFlow directly when only its key is set, downloading over https", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: new Uint8Array([1, 2, 3]).buffer })
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify({ text: "素材产生多个争点。" }) });

    const tool = createXhsGetTranscriptTool(getConfig, siliconflowOnly);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("素材产生多个争点。");

    // Cleartext CDN URL must be upgraded to https for the download.
    const downloadCall = requestUrlMock.mock.calls[1][0] as { url: string };
    expect(downloadCall.url).toBe(AUDIO_URL.replace("http://", "https://"));

    const asrCall = requestUrlMock.mock.calls[2][0] as { url: string; method: string; headers: Record<string, string>; body: ArrayBuffer };
    expect(asrCall.url).toBe("https://api.siliconflow.cn/v1/audio/transcriptions");
    expect(asrCall.method).toBe("POST");
    expect(asrCall.headers.Authorization).toBe("Bearer sk-asr-test");
    expect(asrCall.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("falls back to the original http url when the https download fails", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockRejectedValueOnce(new Error("tls handshake failed"))
      .mockResolvedValueOnce({ status: 200, arrayBuffer: new Uint8Array([1]).buffer })
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify({ text: "ok" }) });

    const tool = createXhsGetTranscriptTool(getConfig, siliconflowOnly);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBeUndefined();
    expect((requestUrlMock.mock.calls[2][0] as { url: string }).url).toBe(AUDIO_URL);
  });

  it("explains video notes without an original-sound track", async () => {
    requestUrlMock.mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload({ native_voice_info: null })) });
    const tool = createXhsGetTranscriptTool(getConfig, bothKeys);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("no original-sound audio track");
  });

  it("explains image notes", async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify(videoNotePayload({ type: "normal", native_voice_info: undefined })),
    });
    const tool = createXhsGetTranscriptTool(getConfig, bothKeys);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("image note");
  });

  it("surfaces SiliconFlow API errors", async () => {
    requestUrlMock
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(videoNotePayload()) })
      .mockResolvedValueOnce({ status: 200, arrayBuffer: new Uint8Array([1]).buffer })
      .mockResolvedValueOnce({ status: 401, text: JSON.stringify({ message: "bad key" }) });
    const tool = createXhsGetTranscriptTool(getConfig, siliconflowOnly);
    const result = await tool.execute({ url_or_id: NOTE_ID });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("rejected the API key");
  });
});
