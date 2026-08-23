import { createPatchNoteTool } from "@/tools/patchNote";
import { createFakeVault } from "../../helpers/fakeVault";

describe("patch_note tool", () => {
  it("replaces a unique match", async () => {
    const { vault, files } = createFakeVault({ "A.md": "line one\nline two\nline three" });
    const result = await createPatchNoteTool(vault).execute({
      path: "A.md",
      old_string: "line two",
      new_string: "line TWO",
    });
    expect(result.isError).toBeUndefined();
    expect(files.get("A.md")).toBe("line one\nline TWO\nline three");
  });

  it("errors when old_string is not found", async () => {
    const { vault } = createFakeVault({ "A.md": "hello" });
    const result = await createPatchNoteTool(vault).execute({
      path: "A.md",
      old_string: "missing",
      new_string: "x",
    });
    expect(result.isError).toBe(true);
  });

  it("errors when old_string matches more than once", async () => {
    const { vault } = createFakeVault({ "A.md": "dup\ndup" });
    const result = await createPatchNoteTool(vault).execute({ path: "A.md", old_string: "dup", new_string: "x" });
    expect(result.isError).toBe(true);
  });
});
