/**
 * Tests for the injectable LLM client port (Task 2). Everything is deterministic
 * and free: the {@link FakeLlmClient} drives the interface, and the real
 * {@link AnthropicLlmClient} is exercised through an **injected transport** so we
 * assert the request shape without a live API call, a network round-trip, or an
 * installed SDK. The only live-path assertion is the missing-key guard.
 */
import { describe, it, expect } from "vitest";
import {
  AnthropicLlmClient,
  FakeLlmClient,
  extractText,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_MAX_TOKENS,
  type LlmRequest,
  type LlmTransport,
} from "./llmClient";

describe("FakeLlmClient", () => {
  it("returns a single canned string on every call and records calls", async () => {
    const fake = new FakeLlmClient("VERDICT");
    expect(await fake.complete([{ role: "user", content: "a" }])).toBe("VERDICT");
    expect(
      await fake.complete([{ role: "user", content: "b" }], { system: "rubric" }),
    ).toBe("VERDICT");

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].messages).toEqual([{ role: "user", content: "a" }]);
    expect(fake.calls[1].opts).toEqual({ system: "rubric" });
  });

  it("returns a list of responses in order, then repeats the last", async () => {
    const fake = new FakeLlmClient(["one", "two"]);
    expect(await fake.complete([])).toBe("one");
    expect(await fake.complete([])).toBe("two");
    expect(await fake.complete([])).toBe("two"); // drained → repeats last
  });

  it("supports a responder function reflecting the request", async () => {
    const fake = new FakeLlmClient((messages) => `echo:${messages[0]?.content ?? ""}`);
    expect(await fake.complete([{ role: "user", content: "ping" }])).toBe("echo:ping");
  });

  it("degrades to an empty string when constructed with no responses", async () => {
    const fake = new FakeLlmClient();
    expect(await fake.complete([])).toBe("");
  });
});

describe("AnthropicLlmClient (injected transport — no live call)", () => {
  it("builds the request shape from config + per-call opts and returns transport text", async () => {
    let captured: LlmRequest | undefined;
    let capturedKey: string | undefined;
    const transport: LlmTransport = async (req, apiKey) => {
      captured = req;
      capturedKey = apiKey;
      return "REPORT_JSON";
    };

    const client = new AnthropicLlmClient({
      model: "m-default",
      maxTokens: 1234,
      apiKey: "test-key",
      transport,
    });

    const out = await client.complete([{ role: "user", content: "hello" }], {
      system: "you are a judge",
      model: "m-override",
    });

    expect(out).toBe("REPORT_JSON");
    expect(capturedKey).toBe("test-key");
    expect(captured).toEqual({
      model: "m-override", // per-call override wins over config
      maxTokens: 1234,
      system: "you are a judge",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("defaults the model to DEFAULT_JUDGE_MODEL and maxTokens to DEFAULT_MAX_TOKENS", async () => {
    let captured: LlmRequest | undefined;
    const transport: LlmTransport = async (req) => {
      captured = req;
      return "";
    };
    const client = new AnthropicLlmClient({ apiKey: "k", transport });

    await client.complete([{ role: "user", content: "x" }]);

    expect(captured?.model).toBe(DEFAULT_JUDGE_MODEL);
    expect(captured?.maxTokens).toBe(DEFAULT_MAX_TOKENS);
    expect(captured?.system).toBeUndefined();
  });
});

describe("extractText (live-transport reply decoding)", () => {
  it("concatenates the text of every text block in order", () => {
    const resp = {
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    };
    expect(extractText(resp)).toBe("Hello world");
  });

  it("skips non-text blocks (e.g. tool_use) and blocks with a non-string text", () => {
    const resp = {
      content: [
        { type: "text", text: "keep" },
        { type: "tool_use", id: "t1", name: "x", input: {} },
        { type: "text", text: 42 }, // malformed text → skipped
        { type: "text", text: "-tail" },
      ],
    };
    expect(extractText(resp)).toBe("keep-tail");
  });

  it("returns an empty string when content is missing, not an array, null, or undefined", () => {
    expect(extractText({})).toBe("");
    expect(extractText({ content: "not-an-array" })).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });

  it("returns an empty string for an empty content array (e.g. a refusal / max_tokens cutoff)", () => {
    expect(extractText({ content: [] })).toBe("");
  });
});

describe("AnthropicLlmClient missing-key guard", () => {
  it("does NOT throw at construction when no key is available", () => {
    expect(() => new AnthropicLlmClient({ apiKey: "" })).not.toThrow();
  });

  it("throws a clear error only when the live transport is actually invoked", async () => {
    // Default transport (no transport injected) + empty key → the guard fires
    // before any SDK load, so this is deterministic and makes no network call.
    const client = new AnthropicLlmClient({ apiKey: "" });
    await expect(
      client.complete([{ role: "user", content: "judge this" }]),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
