import { TextDecoder, TextEncoder } from "node:util";

// jest-environment-jsdom does not always provide these globals, and
// AnthropicClient.ts relies on the real TextEncoder/TextDecoder to parse
// streamed SSE bytes the same way it would in a browser/Capacitor WebView.
if (typeof (global as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  (global as unknown as { TextEncoder: unknown }).TextEncoder = TextEncoder;
}
if (typeof (global as { TextDecoder?: unknown }).TextDecoder === "undefined") {
  (global as unknown as { TextDecoder: unknown }).TextDecoder = TextDecoder;
}
