import { createWriteNoteTool } from "@/tools/writeNote";
import { createFakeVault } from "../../helpers/fakeVault";

describe("write_note tool", () => {
  it("overwrites an existing note", async () => {
    const { vault, files } = createFakeVault({ "A.md": "old" });
    await createWriteNoteTool(vault).execute({ path: "A.md", content: "new" });
    expect(files.get("A.md")).toBe("new");
  });

  it("creates the note if it does not exist", async () => {
    const { vault, files } = createFakeVault();
    const result = await createWriteNoteTool(vault).execute({ path: "New.md", content: "content" });
    expect(files.get("New.md")).toBe("content");
    expect(result.isError).toBeUndefined();
  });
});
