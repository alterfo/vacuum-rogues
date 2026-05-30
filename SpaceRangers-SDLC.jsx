import { useState } from "react";

const SECTIONS = [
  { id: "overview", label: "Project Overview", icon: "🚀" },
  { id: "sdlc", label: "SDLC Framework", icon: "🔄" },
  { id: "prompts", label: "AI Prompt Patterns", icon: "🤖" },
  { id: "stories", label: "User Story Guide", icon: "📋" },
  { id: "antipatterns", label: "AI Anti-Patterns", icon: "⚠️" },
  { id: "checklist", label: "Pre-Prompt Checklist", icon: "✅" },
];

const PHASES = [
  {
    num: "0",
    name: "Proof of Concept",
    status: "done",
    color: "#00ff88",
    goals: ["ONNX loading + fallback", "PixiJS canvas init", "CI/CD pipeline", "IndexedDB baseline"],
    aiFocus: "Architecture generation — use REASONS Canvas format with full entity diagrams",
  },
  {
    num: "1",
    name: "MVP Core Gameplay",
    status: "active",
    color: "#00cfff",
    goals: ["Star map navigation", "Turn-based combat", "Trade system", "Save/load"],
    aiFocus: "Story-by-story implementation — one story per prompt, include AC and test cases",
  },
  {
    num: "2",
    name: "Living Galaxy",
    status: "planned",
    color: "#8888ff",
    goals: ["Procedural events", "NPC autonomy", "Quest system", "Reputation engine"],
    aiFocus: "Incremental feature layering — reference existing domain types explicitly",
  },
  {
    num: "3",
    name: "Neural Onslaught",
    status: "planned",
    color: "#ff88aa",
    goals: ["T5 dialogue generation", "RL tactical AI (PPO)", "VAE content gen", "GRU emotion engine"],
    aiFocus: "ONNX adapter pattern — one model per story, always include FallbackEngine path",
  },
  {
    num: "4",
    name: "Beta Release",
    status: "planned",
    color: "#ffcc00",
    goals: ["TTS integration", "Cloud sync (optional)", "Performance audit", "Production PWA"],
    aiFocus: "Integration + polish — focus on E2E scenarios, edge cases, and error boundaries",
  },
];

const PROMPT_PATTERNS = [
  {
    title: "Architecture / REASONS Canvas",
    badge: "PLANNING",
    badgeColor: "#8888ff",
    when: "Before implementing any new subsystem or phase",
    template: `You are implementing a new subsystem for **Space Rangers: Neural Onslaught** (browser TypeScript game using PixiJS + onnxruntime-web + Vite).

**Context:**
- Current phase: [PHASE_NAME]
- Tech stack: TypeScript 5.4, PixiJS 8, onnxruntime-web 1.17, Zod 3.23, Vitest, Playwright
- Architecture layers: domain → ecs → systems → presentation → ai → data
- Existing: [LIST KEY EXISTING CLASSES]

**Task:** Design the [SUBSYSTEM_NAME] using REASONS Canvas format:
- Requirements (numbered list)
- Entities (class diagram in Mermaid)
- Attributes (fields per class with types)
- State (lifecycle states)
- Operations (method signatures + logic steps)
- Norms (coding rules: no any, immutable domain, logger not console)
- Scenarios (numbered AC per story)

**Constraints:**
- Scenes must NOT call IndexedDB/ONNX directly — route through GameEngine
- All domain fields must be readonly
- Errors thrown via GameBusinessException / GameSystemException only
- ONNX inference via WebWorkerPool only (never on main thread)`,
    tips: ["Always include existing class names to avoid duplicates", "Add the mermaid diagram constraint for type-safe imports", "Mention readonly requirement explicitly — AI often forgets it"],
  },
  {
    title: "User Story Implementation",
    badge: "CODING",
    badgeColor: "#00cfff",
    when: "Implementing a single user story (1 story = 1 prompt)",
    template: `Implement **[STORY-ID]: [Story Title]** for Space Rangers: Neural Onslaught.

**Story Background:**
[PASTE the Background section from the story .md file]

**Scope In:**
[PASTE the Scope In bullet list]

**Acceptance Criteria:**
[PASTE ALL AC items — AI will use these as test targets]

**Existing code to extend (do NOT recreate):**
- \`src/systems/GameEngine.ts\` — scene manager, exposes transitionTo()
- \`src/presentation/GameScene.ts\` — abstract base: initialize(), update(), destroy()
- \`src/types/index.ts\` — SceneType enum, all domain types
- \`src/validation/schemas.ts\` — Zod schemas for saves
- [ADD any other relevant existing files]

**Rules:**
- Follow CODING_RULES.md: no hardcoded pixel positions (RULE-INPUT-01), destroy() clears all refs (RULE-SCENE-01), logger not console (RULE-ERR-02)
- For each AC write a Vitest test in src/tests/[story-id].test.ts
- For E2E scenarios write Playwright tests in e2e/ using Page Object pattern (RULE-E2E-02)
- TypeScript strict mode — no implicit any

Output: implementation files + test files`,
    tips: ["One story per prompt is the golden rule", "Always paste the AC list — it's the AI's definition of done", "Name the existing files — prevents AI from reinventing them"],
  },
  {
    title: "Bug Fix / Regression",
    badge: "DEBUG",
    badgeColor: "#ff8844",
    when: "Fixing a specific failing test or runtime error",
    template: `Fix this failing test/error in Space Rangers: Neural Onslaught.

**Error:**
\`\`\`
[PASTE full error message / stack trace]
\`\`\`

**Failing test (if applicable):**
\`\`\`typescript
[PASTE failing test code]
\`\`\`

**Relevant source files:**
\`\`\`typescript
// [filename]
[PASTE relevant section of source code]
\`\`\`

**What was working before:** [describe last known good state]

**Constraints:**
- Do NOT change test expectations — fix the implementation, not the test
- Do NOT introduce any: use proper types
- If fix touches domain types, update src/validation/schemas.ts accordingly (RULE-DOMAIN-02)
- If fix touches scene lifecycle, verify destroy() clears all references (RULE-SCENE-01)

Output: minimal diff to fix the issue + explanation of root cause`,
    tips: ["Paste the full stack trace, not just the last line", "Explicitly say 'fix the implementation, not the test'", "Mention RULE-DOMAIN-02 if types are involved"],
  },
  {
    title: "ONNX Model Adapter",
    badge: "AI/ML",
    badgeColor: "#ff88aa",
    when: "Adding a new AI model integration",
    template: `Add a new ONNX model adapter for Space Rangers: Neural Onslaught.

**Model:** [MODEL_NAME] (e.g., T5DialogueAdapter)
**Architecture:** [e.g., encoder-decoder text generation]
**Input:** [e.g., Float32Array shape [1, 512] — tokenized prompt]
**Output:** [e.g., Int32Array shape [1, 256] — token IDs]
**Model file:** [URL or placeholder URL]
**Timeout:** [e.g., 3000ms — dialogue models can be slow]

**Existing infrastructure to use:**
- \`src/ai/ONNXModelRegistry.ts\` — call \`.infer(modelId, tensor)\`
- \`src/ai/inference.worker.ts\` — DO NOT modify; inference already runs in workers
- \`src/ai/FallbackEngine.ts\` — implement fallback here for template-based response
- \`src/ai/adapters/\` — create new file here

**Create:**
1. \`src/ai/adapters/[MODEL_NAME]Adapter.ts\`
   - preprocessInput(rawInput: [TYPE]): ort.Tensor
   - postprocessOutput(tensor: ort.Tensor): [OUTPUT_TYPE]
   - infer(input: [TYPE]): Promise<[OUTPUT_TYPE]>
   - Handle InferenceTimeoutException → call FallbackEngine
2. Entry in \`src/ai/ModelManifest.ts\`
3. Unit test in \`src/tests/[model]-adapter.test.ts\`

**RULE-AI-01:** Never call ort.InferenceSession.run() directly — use ONNXModelRegistry.infer()
**RULE-AI-02:** Timeout and FallbackEngine are mandatory`,
    tips: ["Always specify the tensor shape and dtype explicitly", "Remind the AI that inference runs in workers already", "FallbackEngine fallback is non-negotiable per project rules"],
  },
  {
    title: "E2E Test Scenario",
    badge: "TESTING",
    badgeColor: "#00ff88",
    when: "Writing Playwright E2E tests for a feature",
    template: `Write Playwright E2E tests for **[FEATURE_NAME]** in Space Rangers: Neural Onslaught.

**Acceptance Criteria to test:**
[PASTE relevant AC items]

**Page Objects available:**
- \`e2e/page-objects/main-menu.page.ts\` — menu navigation
- \`e2e/page-objects/star-map.page.ts\` — star map interactions
- [ADD others as needed]

**Test file to create:** \`e2e/[feature-name].spec.ts\`

**Rules (from CODING_RULES.md):**
- RULE-E2E-01: NO canvas.click({ position: {x, y} }) — use page.evaluate(() => window.__gameEngine.currentScene.handler()) or data-testid attributes
- RULE-E2E-02: All selectors live in Page Objects — no locators in spec files
- RULE-E2E-03: No waitForTimeout — use waitForFunction or waitForSelector

**Game exposes window.__gameEngine in dev/test mode.**

Output: Page Object additions (if needed) + spec file`,
    tips: ["Paste RULE-E2E-01 verbatim — AI tends to use position clicks", "Mention window.__gameEngine is available — AI may not know this", "List existing Page Objects to avoid duplication"],
  },
];

const STORY_PROBLEMS = [
  {
    problem: "Story is too large (multiple concerns)",
    symptom: "AI generates partial code, skips AC, or loses context mid-way",
    fix: "Split into sub-stories: one per scene, per system, or per AC group. Max ~5 ACs per prompt.",
    example: "❌ 'Implement full combat system'\n✅ 'Implement HexGrid rendering (AC1–AC2)' → separate story for 'Combat turn logic (AC3–AC5)'",
  },
  {
    problem: "Missing context about existing code",
    symptom: "AI creates duplicate classes or uses wrong method names",
    fix: "Always paste the relevant existing file snippets or at minimum list existing class/method names",
    example: "Add to prompt: 'Existing: GameEngine.transitionTo(scene: SceneType), Renderer.app.stage contains gameLayer and uiLayer'",
  },
  {
    problem: "No acceptance criteria",
    symptom: "AI implements something that 'looks right' but doesn't match expectations",
    fix: "Copy the full AC list from the requirements/*.md file into the prompt. Each AC = one test.",
    example: "Include: 'AC3: When credits < price, executeTrade() throws GameBusinessException(INSUFFICIENT_CREDITS)'",
  },
  {
    problem: "Story violates architecture rules",
    symptom: "AI puts IndexedDB calls in scenes, uses console.log, or hardcodes positions",
    fix: "Include a 'Constraints' block with the relevant RULE codes from CODING_RULES.md",
    example: "Add: 'RULE-SCENE-02: scene cannot call IndexedDB — route through GameEngine.saveManager'",
  },
  {
    problem: "Tests written before implementation",
    symptom: "AI changes test expectations to match broken code",
    fix: "State explicitly: 'Do NOT change test expectations — fix the implementation'",
    example: "Put this in the BugFix prompt template and never omit it",
  },
];

const ANTI_PATTERNS = [
  {
    icon: "🎯",
    title: "Pixel Hunting",
    rule: "RULE-INPUT-01",
    bad: "canvas.click({ position: { x: 512, y: 300 } })",
    good: "page.evaluate(() => window.__gameEngine.currentScene.handleStarClick('sol-system'))",
    why: "Pixel coords break on resize/different screens. PixiJS objects have event handlers — use them.",
  },
  {
    icon: "🔄",
    title: "Memory Leaks in destroy()",
    rule: "RULE-SCENE-01",
    bad: "destroy() { this.container.destroy(); }",
    good: "destroy() { this.stars.forEach(s => s.destroy()); this.container.destroy(); clearInterval(this._timer); this._timer = null; }",
    why: "Partial destroy() causes memory bloat. Every DisplayObject, listener, and interval must be cleared.",
  },
  {
    icon: "🔌",
    title: "Scene talks to DB directly",
    rule: "RULE-SCENE-02",
    bad: "// in StarMapScene.ts\nconst db = await openDB('saves', 1);",
    good: "// in StarMapScene.ts\nawait this.engine.saveManager.write('slot1', state);",
    why: "Scenes are presentation. Data access belongs in GameEngine → SaveManager → IndexedDBAdapter.",
  },
  {
    icon: "🧠",
    title: "ONNX on main thread",
    rule: "RULE-AI-01",
    bad: "const session = await ort.InferenceSession.create(modelPath);\nconst output = await session.run(feeds);",
    good: "const result = await this.engine.onnxRegistry.infer('dialogue', inputTensor);",
    why: "ONNX inference blocks the main thread. Always dispatch via WebWorkerPool through ONNXModelRegistry.",
  },
  {
    icon: "🔥",
    title: "Generic error throws",
    rule: "RULE-ERR-01",
    bad: "throw new Error('Not enough credits');",
    good: "throw new GameBusinessException('INSUFFICIENT_CREDITS', `Need ${price} credits, have ${credits}`, { price, credits });",
    why: "Generic errors can't be classified by GlobalExceptionHandler. Typed exceptions enable recovery logic.",
  },
  {
    icon: "📝",
    title: "console.log in production code",
    rule: "RULE-ERR-02",
    bad: "console.log('Model loaded:', modelId);",
    good: "logger.info('Model loaded', { modelId });",
    why: "logger.ts respects __DEBUG__ flag and formats consistently. console.log leaks to production.",
  },
  {
    icon: "🔗",
    title: "Type change without schema update",
    rule: "RULE-DOMAIN-02",
    bad: "// Added field to Player domain type but forgot:\n// src/validation/schemas.ts still has old PlayerSchema",
    good: "// After ANY change to src/types/index.ts or src/domain/*.ts:\n// Update src/validation/schemas.ts AND MigrationPipeline.ts",
    why: "Save game validation will reject saves with the new field. Players lose progress.",
  },
];

const CHECKLIST_ITEMS = [
  { category: "Context", items: ["Which Phase are we in? (0/1/2/3/4)", "Which Story ID? (e.g., STORY-001-003)", "What files already exist that are relevant?", "What was attempted before that failed?"] },
  { category: "Scope", items: ["Is this story small enough? (≤5 ACs per prompt)", "Are the ACs pasted into the prompt?", "Is the 'Scope In' list included?", "Is the 'Scope Out' clear (what NOT to build)?"] },
  { category: "Architecture Rules", items: ["Are relevant RULE codes included?", "Is RULE-INPUT-01 mentioned if UI is involved?", "Is RULE-SCENE-02 mentioned if a scene touches data?", "Is RULE-AI-01 mentioned if ONNX is involved?", "Is RULE-DOMAIN-02 mentioned if types change?"] },
  { category: "Testing", items: ["Is Vitest test expected (unit tests)?", "Is Playwright test expected (E2E)?", "Did you state 'don't change test expectations'?", "Are existing Page Objects listed?"] },
  { category: "Output Clarity", items: ["Is the expected output clearly stated?", "Did you ask for file paths in the output?", "For bugs: did you paste the full error + relevant source?", "Did you ask for explanation of changes?"] },
];

export default function SpaceRangersSDLC() {
  const [activeSection, setActiveSection] = useState("overview");
  const [activePrompt, setActivePrompt] = useState(0);
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [expandedAnti, setExpandedAnti] = useState(null);

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPrompt(idx);
      setTimeout(() => setCopiedPrompt(null), 2000);
    });
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050a14",
      color: "#c8d8f0",
      fontFamily: "'Courier New', 'Consolas', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1a3a5c",
        background: "linear-gradient(180deg, #0a1628 0%, #050a14 100%)",
        padding: "24px 32px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: "radial-gradient(circle at 20% 50%, rgba(0,200,255,0.05) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(100,50,255,0.05) 0%, transparent 50%)",
        }} />
        <div style={{ position: "relative", maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: "#00cfff", letterSpacing: 4, textTransform: "uppercase", marginBottom: 6 }}>
            ◈ Space Rangers: Neural Onslaught
          </div>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 700,
            color: "#e8f4ff",
            letterSpacing: 1,
          }}>
            AI-Assisted SDLC Guide
          </h1>
          <div style={{ marginTop: 6, fontSize: 12, color: "#4a7aa8" }}>
            Prompt engineering · User story patterns · Anti-pattern catalog · Working agreements with AI
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, maxWidth: 1200, margin: "0 auto", width: "100%", padding: "0 16px" }}>
        {/* Sidebar */}
        <div style={{
          width: 200,
          flexShrink: 0,
          borderRight: "1px solid #1a3a5c",
          padding: "24px 0",
          position: "sticky",
          top: 0,
          height: "calc(100vh - 88px)",
          overflowY: "auto",
        }}>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 16px",
                background: activeSection === s.id ? "rgba(0,200,255,0.08)" : "transparent",
                border: "none",
                borderLeft: activeSection === s.id ? "2px solid #00cfff" : "2px solid transparent",
                color: activeSection === s.id ? "#00cfff" : "#4a7aa8",
                fontSize: 12,
                textAlign: "left",
                cursor: "pointer",
                letterSpacing: 0.5,
                transition: "all 0.15s",
              }}
            >
              <span style={{ marginRight: 8 }}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, padding: "24px 32px", minWidth: 0 }}>

          {/* ── OVERVIEW ── */}
          {activeSection === "overview" && (
            <div>
              <SectionHeader title="Project Overview" subtitle="Tech stack, current state, and goals" />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                <InfoCard title="Tech Stack">
                  {[
                    ["Renderer", "PixiJS 8.0+ (WebGL/Canvas2D)"],
                    ["AI Inference", "onnxruntime-web 1.17+ (WASM)"],
                    ["Language", "TypeScript 5.4 strict mode"],
                    ["Build", "Vite 5.2+, ES2022 target"],
                    ["Testing", "Vitest (unit) + Playwright (E2E)"],
                    ["Validation", "Zod 3.23+ for save schemas"],
                    ["Storage", "IndexedDB (saves, model cache)"],
                    ["PWA", "Service Worker + Web Manifest"],
                  ]}
                </InfoCard>
                <InfoCard title="Architecture Layers">
                  {[
                    ["domain/", "Immutable entities (readonly fields)"],
                    ["ecs/", "Entity-Component-System runtime"],
                    ["systems/", "GameEngine, Combat, Trade, Dialogue"],
                    ["presentation/", "PixiJS scenes (no direct DB/AI)"],
                    ["ai/", "ONNX registry, workers, adapters"],
                    ["data/", "SaveManager, IndexedDB, migrations"],
                    ["validation/", "Zod schemas (sync with types!)"],
                    ["exceptions/", "Typed error hierarchy"],
                  ]}
                </InfoCard>
              </div>

              <div style={{
                background: "rgba(0,200,255,0.05)",
                border: "1px solid #1a3a5c",
                borderRadius: 6,
                padding: 16,
                marginBottom: 16,
                fontSize: 12,
                lineHeight: 1.7,
              }}>
                <div style={{ color: "#00cfff", marginBottom: 8, fontWeight: 600 }}>⚡ Current Status — Phase 0 Complete</div>
                <div>37 unit tests passing · TypeScript compiles clean · CI/CD on GitHub Actions · Deployed to Vercel</div>
                <div style={{ color: "#4a7aa8", marginTop: 4 }}>Phase 1 MVP in progress: Star Map → Combat → Trade → Save/Load</div>
              </div>

              <div style={{ background: "rgba(255,100,100,0.05)", border: "1px solid #3a1a1a", borderRadius: 6, padding: 16, fontSize: 12 }}>
                <div style={{ color: "#ff8844", marginBottom: 8, fontWeight: 600 }}>⚠️ Why AI Makes Mistakes Here</div>
                <div style={{ color: "#c8d8f0", lineHeight: 1.8 }}>
                  This codebase has strict layering rules, a custom ECS, typed exception hierarchy, and ONNX inference in Web Workers.
                  Standard AI training data shows simpler patterns. Without context, AI will: put DB calls in scenes, use console.log, 
                  call ONNX on main thread, use pixel coordinates for clicks, and throw generic Error objects.
                  The prompts in this guide prevent all of these.
                </div>
              </div>
            </div>
          )}

          {/* ── SDLC ── */}
          {activeSection === "sdlc" && (
            <div>
              <SectionHeader title="SDLC Framework" subtitle="Phase-by-phase development roadmap with AI focus areas" />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {PHASES.map(p => (
                  <div key={p.num} style={{
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${p.status === "done" ? "#1a5c3a" : p.status === "active" ? "#1a3a5c" : "#1a1a2a"}`,
                    borderLeft: `3px solid ${p.color}`,
                    borderRadius: 6,
                    padding: 16,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                      <span style={{ color: p.color, fontSize: 20, fontWeight: 700 }}>P{p.num}</span>
                      <span style={{ color: "#e8f4ff", fontWeight: 600 }}>{p.name}</span>
                      <span style={{
                        marginLeft: "auto",
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 3,
                        background: p.status === "done" ? "rgba(0,255,136,0.1)" : p.status === "active" ? "rgba(0,200,255,0.1)" : "rgba(100,100,200,0.1)",
                        color: p.status === "done" ? "#00ff88" : p.status === "active" ? "#00cfff" : "#8888ff",
                        letterSpacing: 2,
                        textTransform: "uppercase",
                      }}>
                        {p.status}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#4a7aa8", letterSpacing: 2, marginBottom: 6 }}>GOALS</div>
                        {p.goals.map(g => (
                          <div key={g} style={{ fontSize: 12, color: "#c8d8f0", marginBottom: 3 }}>
                            <span style={{ color: p.color, marginRight: 6 }}>›</span>{g}
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: "#4a7aa8", letterSpacing: 2, marginBottom: 6 }}>AI STRATEGY</div>
                        <div style={{ fontSize: 12, color: "#8aaccf", lineHeight: 1.6 }}>{p.aiFocus}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 12, color: "#4a7aa8", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Story → Code → Test Workflow</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {[
                    "Requirements .md",
                    "→ Analysis (REASONS)",
                    "→ Prompt (one story)",
                    "→ AI generates code",
                    "→ Review vs AC",
                    "→ Vitest passes",
                    "→ Playwright passes",
                    "→ PR merge",
                  ].map((step, i) => (
                    <div key={i} style={{
                      padding: "6px 12px",
                      background: step.startsWith("→") ? "transparent" : "rgba(0,200,255,0.08)",
                      border: step.startsWith("→") ? "none" : "1px solid #1a3a5c",
                      borderRadius: 4,
                      fontSize: 11,
                      color: step.startsWith("→") ? "#4a7aa8" : "#00cfff",
                    }}>{step}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── PROMPTS ── */}
          {activeSection === "prompts" && (
            <div>
              <SectionHeader title="AI Prompt Patterns" subtitle="Battle-tested templates for each development scenario" />

              <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                {PROMPT_PATTERNS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePrompt(i)}
                    style={{
                      padding: "6px 12px",
                      background: activePrompt === i ? "rgba(0,200,255,0.12)" : "transparent",
                      border: `1px solid ${activePrompt === i ? "#00cfff" : "#1a3a5c"}`,
                      borderRadius: 4,
                      color: activePrompt === i ? "#00cfff" : "#4a7aa8",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{
                      padding: "1px 6px",
                      background: p.badgeColor + "22",
                      color: p.badgeColor,
                      borderRadius: 2,
                      fontSize: 9,
                      marginRight: 6,
                      letterSpacing: 1,
                    }}>{p.badge}</span>
                    {p.title}
                  </button>
                ))}
              </div>

              {PROMPT_PATTERNS[activePrompt] && (() => {
                const p = PROMPT_PATTERNS[activePrompt];
                return (
                  <div>
                    <div style={{ marginBottom: 12, fontSize: 12, color: "#8aaccf" }}>
                      <span style={{ color: "#4a7aa8" }}>Use when: </span>{p.when}
                    </div>
                    <div style={{ position: "relative" }}>
                      <pre style={{
                        background: "#030810",
                        border: "1px solid #1a3a5c",
                        borderRadius: 6,
                        padding: 16,
                        fontSize: 11,
                        lineHeight: 1.7,
                        overflowX: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: "#b0ccee",
                        margin: 0,
                      }}>
                        {p.template}
                      </pre>
                      <button
                        onClick={() => handleCopy(p.template, activePrompt)}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          padding: "4px 10px",
                          background: copiedPrompt === activePrompt ? "rgba(0,255,136,0.15)" : "rgba(0,200,255,0.1)",
                          border: `1px solid ${copiedPrompt === activePrompt ? "#00ff88" : "#1a3a5c"}`,
                          borderRadius: 3,
                          color: copiedPrompt === activePrompt ? "#00ff88" : "#00cfff",
                          fontSize: 10,
                          cursor: "pointer",
                          letterSpacing: 1,
                        }}
                      >
                        {copiedPrompt === activePrompt ? "✓ COPIED" : "COPY"}
                      </button>
                    </div>

                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 10, color: "#4a7aa8", letterSpacing: 2, marginBottom: 8 }}>PRO TIPS</div>
                      {p.tips.map((tip, i) => (
                        <div key={i} style={{
                          display: "flex", gap: 8, marginBottom: 6, fontSize: 12, color: "#8aaccf",
                        }}>
                          <span style={{ color: "#00cfff", flexShrink: 0 }}>◆</span>
                          {tip}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── STORIES ── */}
          {activeSection === "stories" && (
            <div>
              <SectionHeader title="User Story Guide" subtitle="Common story problems and how to fix them" />

              {STORY_PROBLEMS.map((p, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid #1a3a5c",
                  borderRadius: 6,
                  padding: 16,
                  marginBottom: 12,
                }}>
                  <div style={{ color: "#ff8844", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                    ⚠ {p.problem}
                  </div>
                  <div style={{ fontSize: 11, color: "#4a7aa8", marginBottom: 8 }}>
                    Symptom: <span style={{ color: "#8aaccf" }}>{p.symptom}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#4a7aa8", marginBottom: 8 }}>
                    Fix: <span style={{ color: "#00ff88" }}>{p.fix}</span>
                  </div>
                  <pre style={{
                    background: "#030810",
                    border: "1px solid #1a3a5c",
                    borderRadius: 4,
                    padding: 10,
                    fontSize: 11,
                    color: "#b0ccee",
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}>
                    {p.example}
                  </pre>
                </div>
              ))}

              <div style={{
                background: "rgba(0,200,255,0.05)",
                border: "1px solid #1a3a5c",
                borderRadius: 6,
                padding: 16,
                marginTop: 8,
              }}>
                <div style={{ color: "#00cfff", fontWeight: 600, marginBottom: 12 }}>Story Template Structure</div>
                <div style={{ fontSize: 11, color: "#8aaccf", lineHeight: 2 }}>
                  {[
                    "Story ID + Title (e.g., STORY-001-003: Zod Save Validation)",
                    "Background — why this story exists, business context",
                    "Scope In — explicit bullet list of what to build",
                    "Scope Out — explicit bullet list of what NOT to build",
                    "Acceptance Criteria — numbered, testable (each AC = one test)",
                    "Test Cases — TC-XXX-NNN format, maps to AC",
                    "Dependencies — what must exist before this story",
                  ].map((item, i) => (
                    <div key={i}>
                      <span style={{ color: "#00cfff", marginRight: 8 }}>{i + 1}.</span>{item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── ANTI-PATTERNS ── */}
          {activeSection === "antipatterns" && (
            <div>
              <SectionHeader title="AI Anti-Patterns" subtitle="What goes wrong and how the rules prevent it" />
              {ANTI_PATTERNS.map((a, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid #1a3a5c",
                    borderRadius: 6,
                    marginBottom: 8,
                    overflow: "hidden",
                  }}
                >
                  <button
                    onClick={() => setExpandedAnti(expandedAnti === i ? null : i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "12px 16px",
                      background: expandedAnti === i ? "rgba(255,100,100,0.06)" : "rgba(255,255,255,0.02)",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{a.icon}</span>
                    <span style={{ color: "#e8f4ff", fontWeight: 600, fontSize: 13 }}>{a.title}</span>
                    <span style={{
                      marginLeft: 8,
                      fontSize: 10,
                      padding: "2px 6px",
                      background: "rgba(255,136,0,0.12)",
                      color: "#ff8844",
                      borderRadius: 2,
                      letterSpacing: 1,
                    }}>{a.rule}</span>
                    <span style={{ marginLeft: "auto", color: "#4a7aa8", fontSize: 12 }}>
                      {expandedAnti === i ? "▲" : "▼"}
                    </span>
                  </button>
                  {expandedAnti === i && (
                    <div style={{ padding: "0 16px 16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#ff4444", letterSpacing: 2, marginBottom: 6 }}>❌ BAD</div>
                          <pre style={{
                            background: "#0d0505",
                            border: "1px solid #3a1a1a",
                            borderRadius: 4,
                            padding: 10,
                            fontSize: 11,
                            color: "#ffaaaa",
                            margin: 0,
                            whiteSpace: "pre-wrap",
                          }}>{a.bad}</pre>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#00ff88", letterSpacing: 2, marginBottom: 6 }}>✅ GOOD</div>
                          <pre style={{
                            background: "#050d08",
                            border: "1px solid #1a3a1a",
                            borderRadius: 4,
                            padding: 10,
                            fontSize: 11,
                            color: "#aaffcc",
                            margin: 0,
                            whiteSpace: "pre-wrap",
                          }}>{a.good}</pre>
                        </div>
                      </div>
                      <div style={{
                        marginTop: 10,
                        padding: "8px 12px",
                        background: "rgba(0,200,255,0.05)",
                        borderRadius: 4,
                        fontSize: 11,
                        color: "#8aaccf",
                        lineHeight: 1.6,
                      }}>
                        <span style={{ color: "#00cfff" }}>Why: </span>{a.why}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── CHECKLIST ── */}
          {activeSection === "checklist" && (
            <div>
              <SectionHeader title="Pre-Prompt Checklist" subtitle="Run through this before sending any prompt to AI" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {CHECKLIST_ITEMS.map((section, si) => (
                  <div key={si} style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid #1a3a5c",
                    borderRadius: 6,
                    padding: 16,
                  }}>
                    <div style={{ fontSize: 10, color: "#00cfff", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" }}>
                      {section.category}
                    </div>
                    {section.items.map((item, ii) => (
                      <CheckboxItem key={ii} label={item} />
                    ))}
                  </div>
                ))}
              </div>

              <div style={{
                marginTop: 20,
                padding: 16,
                background: "rgba(0,255,136,0.04)",
                border: "1px solid #1a3a3a",
                borderRadius: 6,
              }}>
                <div style={{ color: "#00ff88", fontWeight: 600, marginBottom: 8 }}>
                  🚦 Rule of Thumb: If any category has unchecked boxes, your prompt will likely fail.
                </div>
                <div style={{ fontSize: 12, color: "#8aaccf", lineHeight: 1.8 }}>
                  The most common failure mode is sending a large story without ACs. The second most common
                  is forgetting to mention existing files, causing the AI to reinvent the wheel. The third
                  is omitting architecture rules, causing the AI to break the layering constraints.
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <div style={{
        borderTop: "1px solid #1a3a5c",
        padding: "12px 32px",
        fontSize: 10,
        color: "#2a4a6a",
        textAlign: "center",
      }}>
        Space Rangers: Neural Onslaught — AI SDLC Guide · Phase 0 Complete · 16 User Stories · 37 Unit Tests
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, color: "#e8f4ff", fontWeight: 700 }}>{title}</h2>
      <div style={{ marginTop: 4, fontSize: 12, color: "#4a7aa8" }}>{subtitle}</div>
      <div style={{ marginTop: 10, height: 1, background: "linear-gradient(90deg, #1a3a5c 0%, transparent 100%)" }} />
    </div>
  );
}

function InfoCard({ title, children }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid #1a3a5c",
      borderRadius: 6,
      padding: 14,
    }}>
      <div style={{ fontSize: 10, color: "#00cfff", letterSpacing: 3, marginBottom: 10, textTransform: "uppercase" }}>{title}</div>
      {children.map(([key, val]) => (
        <div key={key} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11 }}>
          <span style={{ color: "#4a7aa8", flexShrink: 0, width: 90 }}>{key}</span>
          <span style={{ color: "#c8d8f0" }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

function CheckboxItem({ label }) {
  const [checked, setChecked] = useState(false);
  return (
    <div
      onClick={() => setChecked(!checked)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        marginBottom: 8,
        cursor: "pointer",
      }}
    >
      <div style={{
        width: 14,
        height: 14,
        border: `1px solid ${checked ? "#00ff88" : "#2a4a6a"}`,
        borderRadius: 2,
        flexShrink: 0,
        marginTop: 1,
        background: checked ? "rgba(0,255,136,0.15)" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        color: "#00ff88",
      }}>
        {checked ? "✓" : ""}
      </div>
      <span style={{
        fontSize: 11,
        color: checked ? "#4a7aa8" : "#c8d8f0",
        textDecoration: checked ? "line-through" : "none",
        lineHeight: 1.5,
      }}>{label}</span>
    </div>
  );
}
