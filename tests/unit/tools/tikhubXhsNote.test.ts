import { requestUrl } from "obsidian";

import { DEFAULT_TIKHUB_BASE_URL } from "@/tikhub/api";
import { TIKHUB_NOT_CONFIGURED } from "@/tools/tikhubDouyinVideo";
import { createXhsGetNoteTool, findXhsNoteDetail, summarizeXhsNote } from "@/tools/tikhubXhsNote";

const requestUrlMock = requestUrl as jest.Mock;

const getConfig = () => ({ apiKey: "tk-test", baseUrl: DEFAULT_TIKHUB_BASE_URL });

function respond(body: unknown, status = 200): void {
  requestUrlMock.mockResolvedValueOnce({ status, text: JSON.stringify(body) });
}

beforeEach(() => {
  requestUrlMock.mockReset();
});

const NOTE_ID = "67f298bf000000001c0307ad";

// Mirrors the live get_image_note_detail shape: the note nests under
// data[0].note_list[0], next to a user profile that also carries an id.
const NOTE_DETAIL_PAYLOAD = {
  code: 0,
  success: true,
  data: [
    {
      model_type: "note",
      user: { id: "67dd1c70000000000d00b671", nickname: "叭叭嘴里炫🍱", desc: "个人简介不是笔记" },
      note_list: [
        {
          id: NOTE_ID,
          type: "normal",
          title: "如果幸福是一碗面",
          desc: "谁懂啊！这家面馆的面直接把我香迷糊了🍜".repeat(3),
          time: 1744020246,
          ip_location: "Henan",
          user: { nickname: "叭叭嘴里炫🍱" },
          liked_count: 367,
          collected_count: 110,
          comments_count: 16,
          shared_count: 56,
          images_list: [{}, {}, {}, {}],
        },
      ],
    },
  ],
};

describe("findXhsNoteDetail", () => {
  it("finds the note under note_list, not the user profile", () => {
    const note = findXhsNoteDetail(NOTE_DETAIL_PAYLOAD, NOTE_ID);
    expect(note?.title).toBe("如果幸福是一碗面");
  });

  it("rejects payloads that only contain other notes", () => {
    expect(findXhsNoteDetail(NOTE_DETAIL_PAYLOAD, "6a881584000000002a0135a5")).toBeNull();
  });

  it("takes the first note-shaped object when no id is required", () => {
    const note = findXhsNoteDetail(NOTE_DETAIL_PAYLOAD, null);
    expect(note?.id).toBe(NOTE_ID);
  });
});

describe("summarizeXhsNote", () => {
  it("formats metadata and the full text", () => {
    const note = findXhsNoteDetail(NOTE_DETAIL_PAYLOAD, NOTE_ID);
    const summary = summarizeXhsNote(note ?? {});
    expect(summary).toContain("如果幸福是一碗面");
    expect(summary).toContain("image note");
    expect(summary).toContain("likes 367");
    expect(summary).toContain("Images: 4");
    expect(summary).toContain("香迷糊");
    expect(summary).toContain(`https://www.xiaohongshu.com/explore/${NOTE_ID}`);
  });
});

describe("xiaohongshu_get_note tool", () => {
  it("asks for configuration when no key is set", async () => {
    const result = await createXhsGetNoteTool(() => ({ apiKey: "", baseUrl: DEFAULT_TIKHUB_BASE_URL })).execute({ url_or_id: NOTE_ID });
    expect(result).toEqual({ content: TIKHUB_NOT_CONFIGURED, isError: true });
  });

  it("fetches by note id and verifies the returned id", async () => {
    respond({ code: 200, data: NOTE_DETAIL_PAYLOAD });
    const result = await createXhsGetNoteTool(getConfig).execute({ url_or_id: NOTE_ID });
    expect(requestUrlMock.mock.calls[0][0].url).toContain(`get_image_note_detail?note_id=${NOTE_ID}`);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("如果幸福是一碗面");
  });

  it("passes short links as share_text", async () => {
    respond({ code: 200, data: NOTE_DETAIL_PAYLOAD });
    await createXhsGetNoteTool(getConfig).execute({ url_or_id: "看看这篇 http://xhslink.com/a/AbCd123，复制打开" });
    const url = requestUrlMock.mock.calls[0][0].url as string;
    expect(url).toContain("share_text=" + encodeURIComponent("http://xhslink.com/a/AbCd123"));
    expect(url).not.toContain("note_id");
  });

  it("errors when the requested note is missing from the response", async () => {
    respond({ code: 200, data: NOTE_DETAIL_PAYLOAD });
    const result = await createXhsGetNoteTool(getConfig).execute({ url_or_id: "6a881584000000002a0135a5" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("deleted or private");
  });

  it("rejects inputs without a note reference", async () => {
    const result = await createXhsGetNoteTool(getConfig).execute({ url_or_id: "随便说说" });
    expect(result.isError).toBe(true);
    expect(requestUrlMock).not.toHaveBeenCalled();
  });
});
