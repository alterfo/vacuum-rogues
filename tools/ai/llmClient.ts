import { GameSystemException } from "../../src/exceptions/GameSystemException";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmImage {
  mediaType: string;
  dataBase64: string;
}

export interface LlmCompleteOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
  images?: LlmImage[];
}

export interface LlmClient {
  complete(messages: LlmMessage[], opts?: LlmCompleteOptions): Promise<string>;
}

export interface LlmRequest {
  model: string;
  maxTokens: number;
  system?: string;
  messages: LlmMessage[];
  images?: LlmImage[];
}

export type LlmTransport = (req: LlmRequest, apiKey: string) => Promise<string>;

export const DEFAULT_JUDGE_MODEL = "claude-sonnet-4-6";
export const DEEP_PASS_MODEL = "claude-opus-4-8";
export const DEFAULT_MAX_TOKENS = 4096;

const ANTHROPIC_SDK_MODULE = "@anthropic-ai/sdk";

export function toAnthropicMessages(req: LlmRequest): unknown[] {
  const images = req.images ?? [];
  if (images.length === 0) return req.messages;

  const imageBlocks = images.map((img) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: img.mediaType,
      data: img.dataBase64,
    },
  }));

  const out: { role: string; content: unknown }[] = req.messages.map((m) => ({
    role: m.role,
    content: m.content as unknown,
  }));
  let lastUser = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) {
    out.push({ role: "user", content: imageBlocks });
  } else {
    const text = out[lastUser].content as string;
    out[lastUser] = {
      role: "user",
      content: [...imageBlocks, { type: "text", text }],
    };
  }
  return out;
}

export function extractText(resp: unknown): string {
  const blocks = (resp as { content?: unknown })?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter(
      (b): b is { type: string; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("");
}

export const defaultAnthropicTransport: LlmTransport = async (req, apiKey) => {
  if (!apiKey) {
    throw new GameSystemException(
      "LLM_NO_API_KEY",
      "ANTHROPIC_API_KEY is not set — set it to run the offline LLM judge live.",
    );
  }
  type AnthropicModule = {
    default: new (opts: { apiKey: string }) => {
      messages: { create(args: Record<string, unknown>): Promise<unknown> };
    };
  };
  let mod: AnthropicModule;
  try {
    mod = (await import(/* @vite-ignore */ ANTHROPIC_SDK_MODULE)) as AnthropicModule;
  } catch {
    throw new GameSystemException(
      "LLM_SDK_MISSING",
      `The Anthropic SDK (${ANTHROPIC_SDK_MODULE}) is not installed — run ` +
        `\`npm i -D ${ANTHROPIC_SDK_MODULE}\` to run the offline LLM judge live.`,
    );
  }
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: toAnthropicMessages(req),
  });
  return extractText(resp);
};

export interface AnthropicLlmConfig {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  transport?: LlmTransport;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly transport: LlmTransport;

  constructor(config: AnthropicLlmConfig = {}) {
    this.model = config.model ?? DEFAULT_JUDGE_MODEL;
    this.apiKey = config.apiKey ?? readApiKeyFromEnv();
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.transport = config.transport ?? defaultAnthropicTransport;
  }

  async complete(
    messages: LlmMessage[],
    opts: LlmCompleteOptions = {},
  ): Promise<string> {
    const req: LlmRequest = {
      model: opts.model ?? this.model,
      maxTokens: opts.maxTokens ?? this.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.images && opts.images.length > 0 ? { images: opts.images } : {}),
      messages,
    };
    return this.transport(req, this.apiKey);
  }
}

function readApiKeyFromEnv(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return env?.ANTHROPIC_API_KEY ?? "";
}

export type FakeResponder = (
  messages: LlmMessage[],
  opts?: LlmCompleteOptions,
) => string;

export class FakeLlmClient implements LlmClient {
  readonly calls: { messages: LlmMessage[]; opts?: LlmCompleteOptions }[] = [];

  private readonly queue: string[];
  private readonly responder?: FakeResponder;

  constructor(responses: string | string[] | FakeResponder = "") {
    if (typeof responses === "function") {
      this.responder = responses;
      this.queue = [];
    } else {
      const arr = typeof responses === "string" ? [responses] : [...responses];
      this.queue = arr.length ? arr : [""];
    }
  }

  async complete(
    messages: LlmMessage[],
    opts?: LlmCompleteOptions,
  ): Promise<string> {
    this.calls.push({ messages, opts });
    if (this.responder) return this.responder(messages, opts);
    return this.queue.length > 1 ? (this.queue.shift() as string) : this.queue[0];
  }
}
