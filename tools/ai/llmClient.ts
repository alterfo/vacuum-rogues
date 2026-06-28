/**
 * Injectable LLM client port for the offline oddity-judge / scenario-generator
 * (dev-only, `tools/`-resident — never in the prod bundle or the pre-push gate).
 *
 * The whole judge pipeline (transcript → prompt → report; scenario request →
 * configs) talks to the model through this one tiny seam: an {@link LlmClient}
 * with a single `complete(messages, opts) → text` method. Two implementations:
 *
 *  - {@link AnthropicLlmClient} — the real client. It calls Claude through the
 *    Anthropic SDK (`@anthropic-ai/sdk`), with the **model id + API key
 *    configurable** (key defaults to `ANTHROPIC_API_KEY`, model to
 *    {@link DEFAULT_JUDGE_MODEL} — a cost-appropriate Sonnet for high-volume
 *    judging; {@link DEEP_PASS_MODEL} Opus is selectable for a deeper pass).
 *    The SDK is **lazily loaded inside the default transport** (a dynamic
 *    `import`), and the missing-key guard fires **only when actually invoked
 *    live** — never at module import — so importing this file is free and the
 *    SDK need not even be installed for tests to run.
 *
 *  - {@link FakeLlmClient} — a deterministic test double returning canned
 *    responses (a string, an ordered list, or a responder fn) and recording
 *    every call, so the transcript builder, prompt assembly, report parser and
 *    scenario parser are all unit-testable with **no live API call and no key**.
 *
 * The provider boundary is the {@link LlmTransport} seam: `complete` assembles a
 * provider-agnostic {@link LlmRequest} and hands it to the transport. The
 * default transport is the SDK call; tests inject a fake transport and assert
 * the exact request shape. This keeps every test free, fast, and deterministic.
 *
 * The same one seam also carries the **vision** judge (`tools/ai/visionJudge.ts`):
 * pass {@link LlmCompleteOptions.images} and the live transport folds them into
 * the last user turn as Anthropic image content blocks ({@link toAnthropicMessages}).
 * A text-only completion (no `images`) is byte-for-byte unchanged, so the fake
 * client and every text-judge test keep working without modification.
 */
import { GameSystemException } from "../../src/exceptions/GameSystemException";

/** One chat message in an {@link LlmRequest} (system is a separate top-level field). */
export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A base64-encoded image attached to a completion (for the vision judge). It is
 * folded into the last user turn as an Anthropic image content block by the live
 * transport; the text judge simply never sets it.
 */
export interface LlmImage {
  /** The image MIME type, e.g. `"image/png"` or `"image/jpeg"`. */
  mediaType: string;
  /** The base64-encoded image bytes — no `data:` URI prefix, no newlines. */
  dataBase64: string;
}

/** Per-call overrides for {@link LlmClient.complete}. */
export interface LlmCompleteOptions {
  /** Override the client's configured model id for just this call. */
  model?: string;
  /** Hard cap on output tokens for this call. */
  maxTokens?: number;
  /** System prompt (the rubric / role), folded into the request top-level. */
  system?: string;
  /** Images to attach to the last user turn (vision judge); omit for text-only. */
  images?: LlmImage[];
}

/** The minimal port every judge/scenario module talks to. */
export interface LlmClient {
  /** Complete a chat and return the model's text reply. */
  complete(messages: LlmMessage[], opts?: LlmCompleteOptions): Promise<string>;
}

/** The provider-agnostic request the {@link LlmTransport} receives. */
export interface LlmRequest {
  model: string;
  maxTokens: number;
  system?: string;
  messages: LlmMessage[];
  /** Vision frames to attach to the last user message (omitted for text-only). */
  images?: LlmImage[];
}

/**
 * The provider boundary: turn a request + key into completion text. The default
 * is {@link defaultAnthropicTransport} (the SDK call); tests inject a fake.
 */
export type LlmTransport = (req: LlmRequest, apiKey: string) => Promise<string>;

/** Cost-appropriate default for high-volume judging (per the plan: Sonnet). */
export const DEFAULT_JUDGE_MODEL = "claude-sonnet-4-6";
/** Selectable for a periodic deeper pass (Opus). */
export const DEEP_PASS_MODEL = "claude-opus-4-8";
/** Default output-token cap — enough for a structured oddity report. */
export const DEFAULT_MAX_TOKENS = 4096;

// The SDK module specifier is held in a variable (not a string literal) so the
// bundler never tries to statically resolve it — the import only ever runs in
// the live default transport, which dev tooling exercises with a real key.
const ANTHROPIC_SDK_MODULE = "@anthropic-ai/sdk";

/**
 * Build the Anthropic `messages` payload from a request. Text-only requests pass
 * through verbatim (so the text judge's wire shape is unchanged); when `images`
 * are present they are folded into the **last user turn** as base64 image content
 * blocks placed before its text, matching the Anthropic vision shape. Pure.
 */
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
    // No user turn to attach to — add one carrying just the frames.
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

/** Concatenate the text blocks of an Anthropic Messages response. */
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

/**
 * The live transport: lazily load the Anthropic SDK and call Messages. The
 * missing-key guard is here (not at construction), so it degrades to a clear
 * error **only when actually invoked live** — never at import. Injected
 * (test) transports bypass this entirely, so tests need neither key nor SDK.
 */
export const defaultAnthropicTransport: LlmTransport = async (req, apiKey) => {
  if (!apiKey) {
    throw new GameSystemException(
      "LLM_NO_API_KEY",
      "ANTHROPIC_API_KEY is not set — set it to run the offline LLM judge live.",
    );
  }
  // Dynamic import keeps the SDK out of the import graph (and optional to install).
  // The SDK is deliberately NOT a package.json dependency — importing this module
  // and running every test stays free without it. So when the live path is actually
  // invoked without it installed, degrade to a clear, actionable error (matching the
  // missing-key guard above) rather than an opaque `ERR_MODULE_NOT_FOUND`.
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

/** Construction config for {@link AnthropicLlmClient} — all optional. */
export interface AnthropicLlmConfig {
  /** Default model id (defaults to {@link DEFAULT_JUDGE_MODEL}). */
  model?: string;
  /** API key (defaults to `process.env.ANTHROPIC_API_KEY`). */
  apiKey?: string;
  /** Default output-token cap (defaults to {@link DEFAULT_MAX_TOKENS}). */
  maxTokens?: number;
  /** Transport seam — tests inject a fake; production uses the SDK. */
  transport?: LlmTransport;
}

/**
 * The real client. Constructing it is side-effect-free (no SDK load, no key
 * check); the key is only required when `complete` actually calls the live
 * transport.
 */
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

/** Read `ANTHROPIC_API_KEY` from the environment, degrading to "" when absent. */
function readApiKeyFromEnv(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return env?.ANTHROPIC_API_KEY ?? "";
}

/** A responder fn: derive a canned reply from the request (for richer fakes). */
export type FakeResponder = (
  messages: LlmMessage[],
  opts?: LlmCompleteOptions,
) => string;

/**
 * A deterministic, free test double. Pass a single string (returned every
 * call), an ordered list (returned in turn, repeating the last once drained),
 * or a {@link FakeResponder}. Every call is recorded on {@link FakeLlmClient.calls}.
 */
export class FakeLlmClient implements LlmClient {
  /** Every `(messages, opts)` the fake was asked to complete, in order. */
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
    // Return responses in order; once down to the last, keep returning it.
    return this.queue.length > 1 ? (this.queue.shift() as string) : this.queue[0];
  }
}
