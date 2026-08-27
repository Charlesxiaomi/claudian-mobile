import type { RegisteredTool } from "@/core/types";
import { searchDocs } from "@/feishu/api";
import type { FeishuService } from "@/feishu/FeishuService";
import { feishuErrorResult } from "./feishuReadDoc";

interface FeishuSearchDocsInput {
  query: string;
  count?: number;
}

const MAX_COUNT = 20;

export function createFeishuSearchDocsTool(feishu: FeishuService): RegisteredTool {
  return {
    definition: {
      name: "feishu_search_docs",
      description:
        "Search the user's Feishu cloud documents by keyword. Returns matching document titles with " +
        "their type and token. To read a result, pass its token to feishu_read_doc (docx documents only).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword(s) to search for in document titles and content." },
          count: { type: "number", description: `Maximum results to return, 1-${MAX_COUNT} (default 10).` },
        },
        required: ["query"],
      },
    },
    async execute(rawInput) {
      const { query, count } = rawInput as FeishuSearchDocsInput;
      const trimmed = (query ?? "").trim();
      if (!trimmed) {
        return { content: "Search query must not be empty.", isError: true };
      }
      const limit = Math.min(Math.max(Math.floor(count ?? 10), 1), MAX_COUNT);
      try {
        const token = await feishu.getValidAccessToken();
        const result = await searchDocs(token, trimmed, limit);
        if (result.entities.length === 0) {
          return { content: `No Feishu documents matched "${trimmed}".` };
        }
        const lines = result.entities.map((e, i) => `${i + 1}. ${e.title || "(untitled)"} [type: ${e.docs_type}] [token: ${e.docs_token}]`);
        const summary = `${result.total} match(es)${result.hasMore ? ", showing the first " + result.entities.length : ""}:`;
        return { content: [summary, ...lines].join("\n") };
      } catch (err) {
        return feishuErrorResult(err);
      }
    },
  };
}
