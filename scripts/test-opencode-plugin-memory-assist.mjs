import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-memory-assist-"));
mkdirSync(join(tempDir, ".GCC", "branches", "main"), { recursive: true });
writeFileSync(join(tempDir, ".GCC", ".current_branch"), "main\n", "utf-8");
writeFileSync(
  join(tempDir, ".GCC", "branches", "main", "commit.md"),
  [
    "## Commits",
    "",
    "### abc123 - 2026-02-20T00:00:00Z",
    "**Summary:** Reverted OAuth retry loop after timeout regression",
    "",
    "### def456 - 2026-02-21T00:00:00Z",
    "**Summary:** Use opencontext context --search before retrying auth flow fixes",
  ].join("\n"),
  "utf-8"
);
writeFileSync(
  join(tempDir, ".GCC", "branches", "main", "log.md"),
  "Auth retry failed due to timeout; prior fix involved token refresh guard.\n",
  "utf-8"
);
writeFileSync(
  join(tempDir, ".GCC", "law-enforcer.json"),
  JSON.stringify({
    version: 1,
    mode: "interrupt_continue",
    cooldowns: { interruptionSeconds: 1, sameRuleSeconds: 1 },
    limits: { maxConsecutiveInjections: 2 },
    gcc: {
      requireInit: true,
      requireCheckpointEveryTools: 50,
      requireFailedAttemptLookup: false,
      compactionCheckpointRequired: false,
      skipCheckpointDuringPlanningAgent: true,
      countReadOnlyToolsForCheckpoint: false,
    },
    mcp: {
      requireAwarenessAtSessionStart: false,
      requireUseWhenRelevant: false,
      usageReminderEveryTools: 99,
    },
    research: {
      requireCaptureOnDocsOrGithub: false,
      docsKeywords: ["docs"],
    },
    critic: {
      enabled: true,
      provider: "openai_compatible",
      baseUrl: "https://llm.chutes.ai/v1",
      endpointPath: "/chat/completions",
      model: "zai-org/GLM-4.7-Flash",
      apiKeyEnv: "CHUTES_API_KEY",
      timeoutMs: 3000,
    },
    watchman: {
      enabled: true,
      inspectAssistantTurns: true,
      inspectToolCalls: false,
      inspectCompaction: false,
      inspectOnIdle: false,
      skipDuringPlanningAgent: false,
      includeRecentMessages: 8,
      includeRecentToolCalls: 8,
      minConfidence: 0.8,
    },
    memoryAssist: {
      enabled: true,
      suggestOnly: true,
      minSuggestConfidence: 0.8,
      maxCandidates: 8,
      maxSuggestions: 3,
      triggers: ["assistant_turn"],
      includeAbandonedWarnings: true,
      cooldownSeconds: 0,
    },
    observability: {
      traceEnabled: true,
      traceFile: "law-enforcer-trace.jsonl",
    },
  }),
  "utf-8"
);

const logs = [];
const prompts = [];
const fetchPayloads = [];
const client = {
  app: {
    log: async ({ body }) => {
      logs.push(body);
    },
  },
  tui: {
    showToast: async () => {},
  },
  session: {
    messages: async () => ({
      data: [
        {
          info: { id: "msg-user-1", sessionID: "sess-memory-1", role: "user" },
          parts: [{ type: "text", text: "continue with auth retry fix" }],
        },
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "sess-memory-1",
            role: "assistant",
            finish: "stop",
            agent: "build",
            providerID: "chutes",
            modelID: "zai-org/GLM-4.7-Flash",
            time: { completed: new Date().toISOString() },
          },
          parts: [{ type: "text", text: "I will patch auth retry handling now." }],
        },
      ],
    }),
    promptAsync: async (payload) => {
      prompts.push(payload);
    },
  },
};

const oldFetch = global.fetch;
const oldApiKey = process.env.CHUTES_API_KEY;
process.env.CHUTES_API_KEY = "test-key";

global.fetch = async (_url, options = {}) => {
  const method = String(options?.method || "POST").toUpperCase();
  if (method === "GET") {
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            id: "zai-org/GLM-4.7-Flash",
            max_input_tokens: 128000,
          },
        ],
      }),
    };
  }
  fetchPayloads.push(JSON.parse(String(options?.body || "{}")));
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              violation: false,
              rule: "",
              reason: "No policy violation.",
              correction_prompt: "",
              confidence: 0.91,
              assist: {
                should_suggest: true,
                confidence: 0.9,
                reason: "Prior auth retry fixes are relevant now.",
                suggestions: [
                  {
                    title: "Reuse prior auth retry guard",
                    why_now: "Current task matches previous timeout regression.",
                    action: "Review prior commit before changing retry loop.",
                    command: "opencontext context --search \"auth retry timeout\" --limit 20",
                    memory_refs: [".GCC/branches/main/commit.md"],
                  },
                ],
              },
            }),
          },
        },
      ],
    }),
  };
};

try {
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const OpenContextPlugin = pluginModule.default;
  const hooks = await OpenContextPlugin({ client, directory: tempDir });

  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "sess-memory-1" } },
    },
  });

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant-1",
          sessionID: "sess-memory-1",
          role: "assistant",
          finish: "stop",
          agent: "build",
          providerID: "chutes",
          modelID: "zai-org/GLM-4.7-Flash",
          time: { completed: new Date().toISOString() },
        },
      },
    },
  });

  if (fetchPayloads.length === 0) {
    console.error("FAIL  watchman request was not made");
    process.exit(1);
  }
  const watchmanPayloadRaw = fetchPayloads[0]?.messages?.[1]?.content || "{}";
  const watchmanPayload = JSON.parse(String(watchmanPayloadRaw));
  if (!Array.isArray(watchmanPayload.memoryAssistCandidates)) {
    console.error("FAIL  watchman payload missing memoryAssistCandidates");
    process.exit(1);
  }
  if (!watchmanPayload.memoryAssistBudget || !watchmanPayload.memoryAssistBudget.contextWindowTokens) {
    console.error("FAIL  watchman payload missing memoryAssistBudget context metadata");
    process.exit(1);
  }
  if (watchmanPayload.memoryAssistCandidates.length === 0) {
    console.error("FAIL  expected non-empty memoryAssistCandidates");
    process.exit(1);
  }
  if (prompts.length === 0) {
    console.error("FAIL  memory assist suggestion was not injected");
    process.exit(1);
  }
  const firstPrompt = String(prompts[0]?.body?.parts?.[0]?.text || "");
  if (!firstPrompt.includes("OpenContext Memory Assist (suggestion only):")) {
    console.error("FAIL  suggestion prompt missing expected memory assist header");
    process.exit(1);
  }
  const interruptLog = logs.some((entry) => entry?.message === "law.interrupt.injected");
  if (interruptLog) {
    console.error("FAIL  assist-only flow should not inject interruption");
    process.exit(1);
  }
  const assistLog = logs.some((entry) => entry?.message === "law.memory_assist.suggested");
  if (!assistLog) {
    console.error("FAIL  memory assist log not emitted");
    process.exit(1);
  }

  console.log("PASS  watchman memory assist suggestions are injected without interruption");
} finally {
  global.fetch = oldFetch;
  if (oldApiKey == null) delete process.env.CHUTES_API_KEY;
  else process.env.CHUTES_API_KEY = oldApiKey;
  rmSync(tempDir, { recursive: true, force: true });
}
