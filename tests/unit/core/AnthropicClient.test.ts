import { DEFAULT_BASE_URL, streamMessage, type StreamRequest } from "@/core/AnthropicClient";

function makeStreamResponse(chunks: string[]): Response {
  let index = 0;
  const encoder = new TextEncoder();
  const reader = {
    read: jest.fn(async () => {
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = encoder.encode(chunks[index]);
      index++;
      return { done: false, value };
    }),
    releaseLock: jest.fn(),
  };
  return {
    ok: true,
    body: { getReader: () => reader },
    text: async () => "",
  } as unknown as Response;
}

const baseReq: StreamRequest = {
  apiKey: "test-key",
  baseUrl: DEFAULT_BASE_URL,
  model: "claude-sonnet-5",
  system: "system prompt",
  messages: [],
  tools: [],
  maxTokens: 100,
  signal: new AbortController().signal,
};

// jsdom doesn't define a global `fetch`, so jest.spyOn(global, "fetch") has
// nothing to spy on; install a fresh jest.fn() in its place for each test.
function mockFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>): jest.Mock {
  const fn = jest.fn(impl);
  (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("streamMessage", () => {
  afterEach(() => {
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it("parses SSE events split across chunk boundaries that don't align to line breaks", async () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"1","role":"assistant","model":"m"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_del',
      'ta","text":"hi"}}\n\n',
    ];
    mockFetch(async () => makeStreamResponse(chunks));

    const received: unknown[] = [];
    for await (const event of streamMessage(baseReq)) {
      received.push(event);
    }

    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ type: "message_start" });
    expect(received[1]).toMatchObject({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hi" },
    });
  });

  it("sends the direct-browser-access header, API key, and streaming body", async () => {
    const fetchSpy = mockFetch(async () => makeStreamResponse([]));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamMessage(baseReq)) {
      // drain
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-api-key"]).toBe("test-key");
    const body = JSON.parse(init?.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("calls a custom base URL, tolerating a trailing slash", async () => {
    const fetchSpy = mockFetch(async () => makeStreamResponse([]));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamMessage({ ...baseReq, baseUrl: "https://my-proxy.example.com/" })) {
      // drain
    }

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://my-proxy.example.com/v1/messages");
  });

  it("throws with the status and body text on a non-ok response", async () => {
    mockFetch(
      async () =>
        ({
          ok: false,
          status: 401,
          body: null,
          text: async () => "unauthorized",
        }) as unknown as Response,
    );

    await expect(
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of streamMessage(baseReq)) {
          // drain
        }
      })(),
    ).rejects.toThrow(/401/);
  });

  it("extracts a readable message from an Anthropic-shaped error body", async () => {
    mockFetch(
      async () =>
        ({
          ok: false,
          status: 400,
          body: null,
          text: async () =>
            JSON.stringify({
              type: "error",
              error: { type: "invalid_request_error", message: "messages: roles must alternate" },
            }),
        }) as unknown as Response,
    );

    await expect(
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of streamMessage(baseReq)) {
          // drain
        }
      })(),
    ).rejects.toThrow(/invalid_request_error.*roles must alternate/s);
  });

  it("falls back to the error type when message is null (e.g. an OpenAI-shaped proxy error)", async () => {
    mockFetch(
      async () =>
        ({
          ok: false,
          status: 400,
          body: null,
          text: async () =>
            JSON.stringify({ error: { message: null, type: "invalid_request_error", param: null, code: null } }),
        }) as unknown as Response,
    );

    await expect(
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of streamMessage(baseReq)) {
          // drain
        }
      })(),
    ).rejects.toThrow(/invalid_request_error/);
  });
});
