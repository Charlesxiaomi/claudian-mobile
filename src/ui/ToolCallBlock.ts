import { setIcon } from "obsidian";

import { t } from "@/i18n";

const TOOL_ICONS: Record<string, string> = {
  read_note: "file-text",
  write_note: "file-edit",
  patch_note: "diff",
  create_note: "file-plus",
  search_vault: "search",
  list_files: "list",
};

function iconForTool(name: string): string {
  return TOOL_ICONS[name] ?? "wrench";
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  if (typeof record.path === "string") return record.path;
  if (typeof record.query === "string") return record.query;
  if (typeof record.folder === "string") return record.folder;
  return "";
}

/**
 * A collapsible block for a single tool call: header (icon, name, arg
 * summary, status) that expands to show the full input and result. Created
 * on tool_use_start and patched in place as input/result data arrives,
 * mirroring Claudian's ToolCallRenderer.updateToolCallResult() pattern.
 */
export class ToolCallBlockView {
  readonly el: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly inputEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private expanded = false;
  private toolName: string;

  constructor(container: HTMLElement, name: string) {
    this.toolName = name;
    this.el = container.createDiv({ cls: "claudian-mobile-tool-call" });

    const header = this.el.createDiv({ cls: "claudian-mobile-tool-call-header" });
    const iconEl = header.createSpan({ cls: "claudian-mobile-tool-call-icon" });
    setIcon(iconEl, iconForTool(name));
    header.createSpan({ cls: "claudian-mobile-tool-call-name", text: name });
    this.summaryEl = header.createSpan({ cls: "claudian-mobile-tool-call-summary" });
    this.statusEl = header.createSpan({ cls: "claudian-mobile-tool-call-status", text: t().toolCall.running });

    this.bodyEl = this.el.createDiv({ cls: "claudian-mobile-tool-call-body" });
    this.bodyEl.hide();
    this.inputEl = this.bodyEl.createEl("pre", { cls: "claudian-mobile-tool-call-input" });
    this.resultEl = this.bodyEl.createEl("pre", { cls: "claudian-mobile-tool-call-result" });

    header.addEventListener("click", () => {
      this.expanded = !this.expanded;
      if (this.expanded) {
        this.bodyEl.show();
      } else {
        this.bodyEl.hide();
      }
    });
  }

  setInput(input: unknown): void {
    const summary = summarizeInput(input);
    if (summary) this.summaryEl.setText(summary);
    this.inputEl.setText(JSON.stringify(input, null, 2));

    if (this.toolName === "patch_note" && input && typeof input === "object") {
      const { old_string: oldString, new_string: newString } = input as {
        old_string?: string;
        new_string?: string;
      };
      if (typeof oldString === "string" && typeof newString === "string") {
        this.renderPatchDiff(oldString, newString);
      }
    }
  }

  private renderPatchDiff(oldString: string, newString: string): void {
    this.inputEl.empty();
    this.inputEl.removeClass("claudian-mobile-tool-call-input");
    this.inputEl.addClass("claudian-mobile-diff");
    for (const line of oldString.split("\n")) {
      this.inputEl.createDiv({ cls: "claudian-mobile-diff-delete", text: `- ${line}` });
    }
    for (const line of newString.split("\n")) {
      this.inputEl.createDiv({ cls: "claudian-mobile-diff-insert", text: `+ ${line}` });
    }
  }

  complete(result: { content: string; isError?: boolean }): void {
    this.statusEl.setText(result.isError ? t().toolCall.failed : t().toolCall.done);
    this.statusEl.toggleClass("claudian-mobile-tool-call-error", Boolean(result.isError));
    this.resultEl.setText(result.content);
  }
}
