import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./mcp";

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

test("the server exposes every tool", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    "bcrp_change", "bcrp_check", "bcrp_compare", "bcrp_convert", "bcrp_get",
    "bcrp_info", "bcrp_latest", "bcrp_search", "bcrp_shortcuts", "bcrp_stats",
  ]);
});

test("offline tools answer, and failures come back as tool errors", async () => {
  const client = await connect();
  const shortcuts = await client.callTool({ name: "bcrp_shortcuts", arguments: {} });
  expect(JSON.parse((shortcuts.content as { text: string }[])[0]!.text).fx.code).toBe("PD04638PD");

  const search = await client.callTool({ name: "bcrp_search", arguments: { query: "tipo de cambio", limit: 1 } });
  expect(JSON.parse((search.content as { text: string }[])[0]!.text)[0].code).toBe("PD04638PD");

  const bad = await client.callTool({ name: "bcrp_info", arguments: { series: "nope" } });
  expect(bad.isError).toBe(true);
});
