import type { RegisteredTool, ToolExecutionResult } from "@/core/types";
import { FeishuApiError, parseFeishuDocRef, readDocxRawContent, resolveWikiNode } from "@/feishu/api";
import type { FeishuService } from "@/feishu/FeishuService";
import { FeishuOAuthError } from "@/feishu/oauth";

interface FeishuReadDocInput {
  url: string;
}

export const FEISHU_NOT_CONNECTED =
  "Feishu is not connected. Ask the user to open the plugin settings and use \"Connect Feishu\" first.";

/** Maps auth/API failures to a tool result the model can act on. */
export function feishuErrorResult(err: unknown): ToolExecutionResult {
  if (err instanceof FeishuOAuthError && err.code === "reconnect") {
    return { content: FEISHU_NOT_CONNECTED, isError: true };
  }
  if (err instanceof FeishuApiError || err instanceof FeishuOAuthError) {
    return { content: `Feishu request failed: ${err.message}`, isError: true };
  }
  return { content: `Feishu request failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
}

export function createFeishuReadDocTool(feishu: FeishuService): RegisteredTool {
  return {
    definition: {
      name: "feishu_read_doc",
      description:
        "Read the plain-text content of a Feishu cloud document. Accepts a full document URL " +
        "(a .../docx/... or .../wiki/... link) or a bare document token, e.g. from feishu_search_docs. " +
        "Only new-format docs are readable; sheets, bases and legacy docs are not.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Feishu document URL or bare document token." },
        },
        required: ["url"],
      },
    },
    async execute(rawInput) {
      const { url } = rawInput as FeishuReadDocInput;
      const ref = parseFeishuDocRef(url ?? "");
      if (ref.kind === "invalid") {
        return { content: `"${url}" is not a recognizable Feishu document URL or token.`, isError: true };
      }
      if (ref.kind === "unsupported") {
        return { content: `Unsupported Feishu document type "${ref.pathType}": only docx and wiki links are readable.`, isError: true };
      }
      try {
        const token = await feishu.getValidAccessToken();
        let documentId = ref.token;
        if (ref.kind === "wiki") {
          const node = await resolveWikiNode(token, ref.token);
          if (node.objType !== "docx") {
            return { content: `This wiki page is a "${node.objType}" document, which is not readable (only docx is).`, isError: true };
          }
          documentId = node.objToken;
        }
        const content = await readDocxRawContent(token, documentId);
        return { content: content || "(The document is empty.)" };
      } catch (err) {
        return feishuErrorResult(err);
      }
    },
  };
}
