import { createReadNoteTool } from "@/tools/readNote";
import { createFakeVault } from "../../helpers/fakeVault";

describe("read_note tool", () => {
  it("reads existing note content", async () => {
    const { vault } = createFakeVault({ "Notes/A.md": "hello" });
    const result = await createReadNoteTool(vault).execute({ path: "Notes/A.md" });
    expect(result.content).toBe("hello");
    expect(result.isError).toBeUndefined();
  });

  it("errors when the note does not exist", async () => {
    const { vault } = createFakeVault();
    const result = await createReadNoteTool(vault).execute({ path: "Missing.md" });
    expect(result.isError).toBe(true);
  });

  it("rejects path traversal", async () => {
    const { vault } = createFakeVault();
    await expect(createReadNoteTool(vault).execute({ path: "../secret.md" })).rejects.toThrow();
  });
});
