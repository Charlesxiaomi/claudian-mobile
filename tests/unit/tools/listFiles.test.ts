import { createListFilesTool } from "@/tools/listFiles";
import { createFakeVault } from "../../helpers/fakeVault";

describe("list_files tool", () => {
  it("lists all files when no folder is given", async () => {
    const { vault } = createFakeVault({ "A.md": "", "Folder/B.md": "" });
    const result = await createListFilesTool(vault).execute({});
    expect(result.content).toContain("A.md");
    expect(result.content).toContain("Folder/B.md");
  });

  it("filters by folder prefix", async () => {
    const { vault } = createFakeVault({ "A.md": "", "Folder/B.md": "", "Folder/C.md": "" });
    const result = await createListFilesTool(vault).execute({ folder: "Folder" });
    expect(result.content).toBe("Folder/B.md\nFolder/C.md");
  });
});
