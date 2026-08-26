import { DEFAULT_BASE_URL, fetchModels, streamMessage, testConnection, type StreamRequest } from "@/core/AnthropicClient";

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
  effort: "high",
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
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    const headers = init?.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-api-key"]).toBe("test-key");
    const body = JSON.parse(init?.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("claude-sonnet-5");
  });

  it("sends the default high effort as output_config.effort", async () => {
    const fetchSpy = mockFetch(async () => makeStreamResponse([]));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamMessage(baseReq)) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("sends the chosen reasoning effort as output_config.effort", async () => {
    const fetchSpy = mockFetch(async () => makeStreamResponse([]));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamMessage({ ...baseReq, effort: "xhigh" })) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.output_config).toEqual({ effort: "xhigh" });
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

function makeJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("fetchModels", () => {
  afterEach(() => {
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it("parses Anthropic/OpenAI-style {data: [{id}]} bodies and hits /v1/models", async () => {
    const fetchSpy = mockFetch(async () =>
      makeJsonResponse(200, { data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }),
    );

    const ids = await fetchModels({ apiKey: "k", baseUrl: DEFAULT_BASE_URL });

    expect(ids).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.deepseek.com/anthropic/v1/models");
  });

  it("treats an error wrapped in HTTP 200 as a failure, not a success", async () => {
    // Some gateways (e.g. Zhipu) return auth errors with HTTP 200.
    mockFetch(async () => makeJsonResponse(200, { code: 401, msg: "令牌已过期", success: false }));

    await expect(fetchModels({ apiKey: "k", baseUrl: DEFAULT_BASE_URL })).rejects.toThrow();
  });

  it("falls back to the origin when the pathed /v1/models 404s (e.g. DeepSeek)", async () => {
    const fetchSpy = mockFetch(async (url) =>
      String(url) === "https://api.deepseek.com/v1/models"
        ? makeJsonResponse(200, { data: [{ id: "deepseek-chat" }] })
        : makeJsonResponse(404, {}),
    );

    const ids = await fetchModels({ apiKey: "k", baseUrl: "https://api.deepseek.com/anthropic" });

    expect(ids).toEqual(["deepseek-chat"]);
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
      "https://api.deepseek.com/anthropic/v1/models",
      "https://api.deepseek.com/v1/models",
    ]);
  });

  it("surfaces the body detail on a non-ok response", async () => {
    mockFetch(async () =>
      makeJsonResponse(401, { error: { type: "authentication_error", message: "API key is invalid." } }),
    );

    await expect(fetchModels({ apiKey: "bad", baseUrl: DEFAULT_BASE_URL })).rejects.toThrow(
      /API key is invalid/,
    );
  });
});

describe("testConnection", () => {
  const opts = { apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "deepseek-chat", effort: "high" as const };

  afterEach(() => {
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it("passes once the first valid SSE event arrives, via the real streaming path", async () => {
    const fetchSpy = mockFetch(async () =>
      makeStreamResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"1","role":"assistant","model":"m"}}\n\n',
      ]),
    );

    await expect(testConnection(opts)).resolves.toBeUndefined();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(JSON.parse(String(init?.body)).stream).toBe(true);
  });

  it("fails on an SSE error event, passing the gateway's detail through", async () => {
    mockFetch(async () =>
      makeStreamResponse([
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      ]),
    );

    await expect(testConnection(opts)).rejects.toThrow(/Overloaded/);
  });

  it("fails when the stream closes without a single event", async () => {
    mockFetch(async () => makeStreamResponse([]));

    await expect(testConnection(opts)).rejects.toThrow();
  });
});
