import { describe, expect, test } from "bun:test";

import { toolCatalog } from "./tools";

// What Claude's connectors directory checks on every tool (docs/claude-directory.md): a title, readOnlyHint or
// destructiveHint, and a name of at most 64 characters.
describe("MCP tool catalog", () => {
  const tools = toolCatalog();

  test("names are unique snake_case of at most 64 characters, and every tool has a title and description", () => {
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("read tools are read-only and never destructive; write tools say whether they are destructive", () => {
    for (const t of tools) {
      if (t.scope === "finance:read") {
        expect({ name: t.name, readOnly: t.readOnly }).toEqual({ name: t.name, readOnly: true });
        expect(t.destructive).toBeUndefined();
        expect(t.chat === undefined || t.chat === "read").toBe(true);
      } else {
        expect({ name: t.name, readOnly: t.readOnly ?? false }).toEqual({ name: t.name, readOnly: false });
        expect({ name: t.name, destructive: typeof t.destructive }).toEqual({ name: t.name, destructive: "boolean" });
      }
    }
  });

  test("tools that change or remove existing data are destructive", () => {
    const destructive = tools.filter((t) => t.destructive).map((t) => t.name);
    for (const name of ["delete_scenario", "undo_import", "update_transaction", "categorize", "set_budget", "save_scenario", "set_claim_status", "mark_reimbursable", "create_rule"]) {
      expect(destructive).toContain(name);
    }
  });
});
