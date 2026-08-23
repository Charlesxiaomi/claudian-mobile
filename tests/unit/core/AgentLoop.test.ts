import { runAgentLoop } from "@/core/AgentLoop";
import { streamMessage } from "@/core/AnthropicClient";
import type { AgentEvent, AgentSettings, RegisteredTool, StreamEvent } from "@/core/types";

jest.mock("@/core/AnthropicClient");
const mockedStreamMessage = streamMessage as jest.MockedFunction<typeof streamMessage>;

async function* eventsOf(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event;
}

const settings: AgentSettings = {
  apiKey: "key",
  baseUrl: "https://api.anthropic.com",
  model: "claude-sonnet-5",
  maxOutputTokens: 100,
  maxIterations: 5,
  systemPrompt: "system",
};

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe("runAgentLoop", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("executes a requested tool then continues to a final text turn", async () => {
    const execute = jest.fn().mockResolvedValue({ content: "tool ran" });
    const tools = new Map<string, RegisteredTool>([
      ["read_note", { definition: { name: "read_note", description: "d", input_schema: {} }, execute }],
    ]);

    mockedStreamMessage
      .mockImplementationOnce(() =>
        eventsOf([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "t1", name: "read_note", input: {} },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"path":"A.md"}' },
          },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "tool_use" } },
        ]),
      )
      .mockImplementationOnce(() =>
        eventsOf([
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
        ]),
      );

    const events = await collect(
      runAgentLoop(
        [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools,
        settings,
        new AbortController().signal,
      ),
    );

    expect(execute).toHaveBeenCalledWith({ path: "A.md" });
    expect(mockedStreamMessage).toHaveBeenCalledTimes(2);

    expect(events).toContainEqual({ type: "tool_use_start", id: "t1", name: "read_note" });
    expect(events).toContainEqual({
      type: "tool_result",
      id: "t1",
      result: { content: "tool ran", isError: undefined },
    });

    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      // user(initial), assistant(tool_use), user(tool_result), assistant(text)
      expect(done.messages).toHaveLength(4);
      expect(done.messages[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "Done." }] });
    }
  });

  it("ignores unrecognized content block types (e.g. thinking blocks) instead of misparsing them as tool calls", async () => {
    const tools = new Map<string, RegisteredTool>();

    mockedStreamMessage.mockImplementationOnce(() =>
      eventsOf([
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "should be ignored" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello." } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ]),
    );

    const events = await collect(
      runAgentLoop(
        [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools,
        settings,
        new AbortController().signal,
      ),
    );

    expect(events.some((e) => e.type === "tool_use_start")).toBe(false);

    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      // The thinking block must not appear as a bogus tool_use in persisted history.
      expect(done.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Hello." }] });
    }
  });

  it("stops and reports an error once maxIterations is reached", async () => {
    const tools = new Map<string, RegisteredTool>();
    mockedStreamMessage.mockImplementation(() =>
      eventsOf([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "loop", name: "unknown_tool", input: {} },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
      ]),
    );

    const events = await collect(
      runAgentLoop(
        [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools,
        { ...settings, maxIterations: 3 },
        new AbortController().signal,
      ),
    );

    expect(mockedStreamMessage).toHaveBeenCalledTimes(3);
    expect(events.some((e) => e.type === "error" && /maximum/.test(e.message))).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
