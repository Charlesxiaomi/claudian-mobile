import { createCreateNoteTool } from "@/tools/createNote";
import { createFakeVault } from "../../helpers/fakeVault";

describe("create_note tool", () => {
  it("creates a new note", async () => {
    const { vault, files } = createFakeVault();
    await createCreateNoteTool(vault).execute({ path: "New.md", content: "hi" });
    expect(files.get("New.md")).toBe("hi");
  });

  it("fails if the note already exists", async () => {
    const { vault } = createFakeVault({ "Existing.md": "x" });
    const result = await createCreateNoteTool(vault).execute({ path: "Existing.md", content: "y" });
    expect(result.isError).toBe(true);
  });
});
