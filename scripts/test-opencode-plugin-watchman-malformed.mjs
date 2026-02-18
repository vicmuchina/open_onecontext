import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-watchman-malformed-"));
mkdirSync(join(tempDir, ".GCC"), { recursive: true });
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
      compactionCheckpointRequired: true,
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
      authHeader: "authorization",
      apiKeyPrefix: "Bearer",
      model: "openai/gpt-oss-120b-TEE",
      apiKeyEnv: "CHUTES_API_KEY",
      timeoutMs: 3000,
      maxTokensWatchman: 200,
      strictJsonRetryAttempts: 1,
    },
    watchman: {
      enabled: true,
      inspectAssistantTurns: true,
      inspectToolCalls: false,
      inspectCompaction: false,
      inspectOnIdle: false,
      skipDuringPlanningAgent: false,
      includeRecentMessages: 6,
      includeRecentToolCalls: 6,
    },
    observability: {
      traceEnabled: true,
      traceFile: "law-enforcer-trace.jsonl",
    },
  }),
  "utf-8"
);

const logEntries = [];
const prompts = [];
const client = {
  app: {
    log: async ({ body }) => {
      logEntries.push(body);
    },
  },
  tui: {
    showToast: async () => {},
  },
  session: {
    messages: async () => ({
      data: [
        {
          info: {
            id: "msg-user-1",
            sessionID: "sess-malformed-1",
            role: "user",
          },
          parts: [{ type: "text", text: "test opencontext" }],
        },
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "sess-malformed-1",
            role: "assistant",
            finish: "stop",
            agent: "build",
            providerID: "chutes",
            modelID: "zai-org/GLM-4.7-Flash",
            time: { completed: new Date().toISOString() },
          },
          parts: [{ type: "text", text: "Continuing without checkpoint." }],
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
let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  return ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: "This is non-JSON text from provider and must not cause injection.",
        },
      },
    ],
  }),
  });
};

try {
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const OpenContextPlugin = pluginModule.default;
  const hooks = await OpenContextPlugin({ client, directory: tempDir });

  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "sess-malformed-1" } },
    },
  });

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant-1",
          sessionID: "sess-malformed-1",
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

  const verdictLog = logEntries.find((entry) => entry?.message === "law.watchman.verdict");
  if (!verdictLog) {
    console.error("FAIL  watchman verdict log missing");
    process.exit(1);
  }
  if (prompts.length > 0) {
    console.error("FAIL  malformed watchman output triggered prompt injection");
    process.exit(1);
  }
  const verdictBlob = JSON.stringify(verdictLog);
  if (!verdictBlob.includes("parse_invalid_")) {
    console.error("FAIL  malformed output did not surface parse_invalid_* source");
    process.exit(1);
  }
  if (fetchCalls !== 2) {
    console.error(`FAIL  expected strict retry fetch count=2, got ${fetchCalls}`);
    process.exit(1);
  }

  console.log("PASS  malformed watchman output is ignored without interruption");
} finally {
  global.fetch = oldFetch;
  if (oldApiKey == null) delete process.env.CHUTES_API_KEY;
  else process.env.CHUTES_API_KEY = oldApiKey;
  rmSync(tempDir, { recursive: true, force: true });
}
