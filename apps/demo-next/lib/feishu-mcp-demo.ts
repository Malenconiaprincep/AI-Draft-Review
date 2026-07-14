import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ConnectorToken } from "@tutti/content-import";

export const FEISHU_MCP_SERVER_URL = process.env.FEISHU_MCP_SERVER_URL || "https://mcp.feishu.cn/mcp";
const ALLOWED_TOOLS = "fetch-doc,fetch-file,search-doc,list-docs";

export async function callFeishuMcpFetch(
  token: ConnectorToken,
  source: string
): Promise<unknown> {
  return withFeishuMcpClient(token, (client) => client.callTool({
    name: "fetch-doc",
    arguments: { docID: source }
  }));
}

export async function callFeishuMcpSearch(
  token: ConnectorToken,
  query: string
): Promise<unknown> {
  return withFeishuMcpClient(token, async (client) => {
    const tools = await client.listTools();
    const searchTool = tools.tools.find((tool) => tool.name === "search-doc");
    const properties = searchTool?.inputSchema?.properties ?? {};
    const queryKey = ["query", "searchKey", "search_key", "keyword", "keyWord"]
      .find((key) => key in properties) ?? "query";
    return client.callTool({
      name: "search-doc",
      arguments: { [queryKey]: query }
    });
  });
}

async function withFeishuMcpClient<T>(
  token: ConnectorToken,
  operation: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client(
    { name: "tutti-feishu-content-import", version: "0.1.0" },
    { capabilities: {} }
  );
  const tokenHeader = token.accessToken.startsWith("t-")
    ? "X-Lark-MCP-TAT"
    : "X-Lark-MCP-UAT";
  const transport = new StreamableHTTPClientTransport(new URL(FEISHU_MCP_SERVER_URL), {
    requestInit: {
      headers: {
        [tokenHeader]: token.accessToken,
        "X-Lark-MCP-Allowed-Tools": ALLOWED_TOOLS
      }
    },
    reconnectionOptions: {
      initialReconnectionDelay: 250,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: 2
    }
  });

  try {
    await client.connect(transport);
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
