import { toSafeVaultPath } from "@/tools/pathSafety";

describe("toSafeVaultPath", () => {
  it("passes through a normal relative path", () => {
    expect(toSafeVaultPath("Folder/Note.md")).toBe("Folder/Note.md");
  });

  it("rejects an empty path", () => {
    expect(() => toSafeVaultPath("")).toThrow();
  });

  it("rejects an absolute path", () => {
    expect(() => toSafeVaultPath("/etc/passwd")).toThrow();
  });

  it("rejects a drive-letter absolute path", () => {
    expect(() => toSafeVaultPath("C:\\Windows\\System32")).toThrow();
  });

  it("rejects parent-directory traversal", () => {
    expect(() => toSafeVaultPath("../outside.md")).toThrow();
    expect(() => toSafeVaultPath("Folder/../../outside.md")).toThrow();
  });
});
