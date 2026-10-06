import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SHORTCUTS } from "./shortcuts";

const skill = readFileSync(new URL("../skills/bcrp/SKILL.md", import.meta.url), "utf8");
const mcp = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");

test("the skill has valid frontmatter", () => {
  const m = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
  expect(m).not.toBeNull();
  expect(m![1]).toBe("bcrp");
  expect(m![2]!.length).toBeLessThanOrEqual(1024);
});

test("the skill mentions every shortcut", () => {
  for (const name of Object.keys(SHORTCUTS)) expect(skill).toContain(`\`${name}\``);
});

test("the skill and the MCP server agree on tool names", () => {
  const registered = [...mcp.matchAll(/registerTool\(\s*"(bcrp_[a-z]+)"/g)].map((m) => m[1]!).sort();
  const documented = [...new Set([...skill.matchAll(/`(bcrp_[a-z]+)`/g)].map((m) => m[1]!))].sort();
  expect(registered.length).toBe(7);
  // every registered tool is documented, and the skill documents nothing that does not exist
  expect(documented).toEqual(registered);
});
