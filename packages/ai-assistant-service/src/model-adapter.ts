export type LLMProviderConfig = {
  provider: "deepseek" | "minimax" | "openai_compatible" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
};

export interface ModelAdapter {
  generateReviewProposal(args: {
    prompt: string;
    schema: unknown;
    providerConfig?: LLMProviderConfig;
  }): Promise<unknown>;
}

export class MinimaxModelAdapter implements ModelAdapter {
  async generateReviewProposal(args: {
    prompt: string;
    schema: unknown;
    providerConfig?: LLMProviderConfig;
  }): Promise<unknown> {
    const config = args.providerConfig;
    if (!config?.apiKey) {
      throw new Error("Minimax API key is required for the Minimax model adapter.");
    }

    const endpoint = config.baseUrl ?? "https://api.minimax.chat/v1/chat/completions";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "You return strict JSON for an AI draft review assistant."
          },
          {
            role: "user",
            content: args.prompt
          }
        ],
        temperature: 0.2,
        max_tokens: config.maxTokens ?? 1200,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Minimax request failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Minimax response did not include choices[0].message.content.");
    }
    return parseJsonContent(content);
  }
}

export class DeepSeekModelAdapter implements ModelAdapter {
  async generateReviewProposal(args: {
    prompt: string;
    schema: unknown;
    providerConfig?: LLMProviderConfig;
  }): Promise<unknown> {
    return requestOpenAICompatibleJson({
      ...args,
      providerName: "DeepSeek",
      defaultBaseUrl: "https://api.deepseek.com/chat/completions"
    });
  }
}

export class OpenAICompatibleModelAdapter implements ModelAdapter {
  async generateReviewProposal(args: {
    prompt: string;
    schema: unknown;
    providerConfig?: LLMProviderConfig;
  }): Promise<unknown> {
    return requestOpenAICompatibleJson({
      ...args,
      providerName: "OpenAI-compatible provider",
      defaultBaseUrl: args.providerConfig?.baseUrl ?? ""
    });
  }
}

export function resolveProviderConfigFromEnv(env: Record<string, string | undefined>): LLMProviderConfig | undefined {
  if (env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      model: env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
      thinking: env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled",
      maxTokens: env.DEEPSEEK_MAX_TOKENS ? Number(env.DEEPSEEK_MAX_TOKENS) : 1200
    };
  }

  if (env.OPENAI_COMPATIBLE_API_KEY && env.OPENAI_COMPATIBLE_MODEL && env.OPENAI_COMPATIBLE_BASE_URL) {
    return {
      provider: "openai_compatible",
      model: env.OPENAI_COMPATIBLE_MODEL,
      apiKey: env.OPENAI_COMPATIBLE_API_KEY,
      baseUrl: env.OPENAI_COMPATIBLE_BASE_URL,
      maxTokens: env.OPENAI_COMPATIBLE_MAX_TOKENS ? Number(env.OPENAI_COMPATIBLE_MAX_TOKENS) : 1200
    };
  }

  const minimaxApiKey = env.MINIMAX_API_KEY;
  const minimaxModel = env.MINIMAX_MODEL;
  if (!minimaxApiKey || !minimaxModel) return undefined;

  return {
    provider: "minimax",
    model: minimaxModel,
    apiKey: minimaxApiKey,
    baseUrl: env.MINIMAX_BASE_URL,
    maxTokens: env.MINIMAX_MAX_TOKENS ? Number(env.MINIMAX_MAX_TOKENS) : 1200
  };
}

export function createModelAdapterForProvider(config: LLMProviderConfig): ModelAdapter {
  if (config.provider === "deepseek") return new DeepSeekModelAdapter();
  if (config.provider === "openai_compatible") return new OpenAICompatibleModelAdapter();
  return new MinimaxModelAdapter();
}

async function requestOpenAICompatibleJson(args: {
  prompt: string;
  providerConfig?: LLMProviderConfig;
  providerName: string;
  defaultBaseUrl: string;
}): Promise<unknown> {
  const config = args.providerConfig;
  if (!config?.apiKey) {
    throw new Error(`${args.providerName} API key is required.`);
  }
  const endpoint = normalizeChatCompletionsEndpoint(config.baseUrl ?? args.defaultBaseUrl);
  if (!endpoint) {
    throw new Error(`${args.providerName} base URL is required.`);
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: "你是 Tutti 的 AI 草稿审阅助手。你必须返回严格 JSON。"
      },
      {
        role: "user",
        content: args.prompt
      }
    ],
    temperature: 0.2,
    max_tokens: config.maxTokens ?? 1200,
    response_format: { type: "json_object" }
  };

  if (config.provider === "deepseek") {
    body.thinking = { type: config.thinking ?? "disabled" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${args.providerName} request failed: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${args.providerName} response did not include choices[0].message.content.`);
  }
  return parseJsonContent(content);
}

function normalizeChatCompletionsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

function parseJsonContent(content: string): unknown {
  const jsonLike = extractJsonContent(content);

  try {
    return JSON.parse(jsonLike);
  } catch (error) {
    const repaired = repairCommonJsonIssues(jsonLike);
    if (repaired !== jsonLike) return JSON.parse(repaired);
    throw error;
  }
}

function extractJsonContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const match = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/);
  if (match?.[1]) return match[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Model response is not valid JSON.");
}

function repairCommonJsonIssues(json: string): string {
  return json
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/^\uFEFF/, "");
}
