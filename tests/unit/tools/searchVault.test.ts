import { createSearchVaultTool } from "@/tools/searchVault";
import { createFakeVault } from "../../helpers/fakeVault";

describe("search_vault tool", () => {
  it("finds matches across notes with snippets", async () => {
    const { vault } = createFakeVault({ "A.md": "the quick brown fox", "B.md": "nothing relevant" });
    const result = await createSearchVaultTool(vault).execute({ query: "quick" });
    expect(result.content).toContain("A.md:1");
  });

  it("returns a no-matches message", async () => {
    const { vault } = createFakeVault({ "A.md": "hello" });
    const result = await createSearchVaultTool(vault).execute({ query: "zzz" });
    expect(result.content).toMatch(/No matches/);
  });

  it("caps results at the given limit", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`N${i}.md`] = "match here";
    const { vault } = createFakeVault(files);
    const result = await createSearchVaultTool(vault).execute({ query: "match", limit: 3 });
    expect(result.content.split("\n")).toHaveLength(3);
  });
});
