import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-runtime-config-"));
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
      requireCheckpointEveryTools: 99,
      requireFailedAttemptLookup: false,
      compactionCheckpointRequired: false,
      skipCheckpointDuringPlanningAgent: true,
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
      model: "openai/gpt-oss-120b-TEE",
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
    },
    observability: {
      traceEnabled: true,
      traceFile: "law-enforcer-trace.jsonl",
    },
  }),
  "utf-8"
);
writeFileSync(
  join(tempDir, ".GCC", "law-runtime.json"),
  JSON.stringify({
    critic: {
      apiKey: "runtime-config-key",
      model: "openai/gpt-oss-120b-TEE",
    },
  }),
  "utf-8"
);
writeFileSync(join(tempDir, ".GCC", "law-policy.txt"), "Use OpenContext workflow.\n", "utf-8");

const logEntries = [];
const fetchCalls = [];
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
          info: { id: "msg-user-1", sessionID: "sess-runtime-1", role: "user" },
          parts: [{ type: "text", text: "continue" }],
        },
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "sess-runtime-1",
            role: "assistant",
            finish: "stop",
            agent: "build",
            providerID: "chutes",
            modelID: "zai-org/GLM-4.7-Flash",
            time: { completed: new Date().toISOString() },
          },
          parts: [{ type: "text", text: "done" }],
        },
      ],
    }),
  },
};

const oldFetch = global.fetch;
const oldApiKey = process.env.CHUTES_API_KEY;
delete process.env.CHUTES_API_KEY;

global.fetch = async (url, options = {}) => {
  fetchCalls.push({ url, options });
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              violation: false,
              rule: "",
              reason: "No violation",
              correction_prompt: "",
              confidence: 0.8,
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
      properties: { info: { id: "sess-runtime-1" } },
    },
  });

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant-1",
          sessionID: "sess-runtime-1",
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

  if (fetchCalls.length === 0) {
    console.error("FAIL  watchman call did not execute using runtime config");
    process.exit(1);
  }
  const call = fetchCalls[0];
  const headers = call?.options?.headers || {};
  const auth = headers.authorization || headers.Authorization || "";
  const body = JSON.parse(call?.options?.body || "{}");
  if (!String(auth).includes("runtime-config-key")) {
    console.error("FAIL  runtime config API key was not used");
    process.exit(1);
  }
  if (body.model !== "openai/gpt-oss-120b-TEE") {
    console.error("FAIL  runtime config model override was not used");
    process.exit(1);
  }

  const verdictLog = logEntries.find((entry) => entry?.message === "law.watchman.verdict");
  if (!verdictLog) {
    console.error("FAIL  watchman verdict log missing");
    process.exit(1);
  }

  console.log("PASS  runtime config provides API key/model without env export");
} finally {
  global.fetch = oldFetch;
  if (oldApiKey == null) delete process.env.CHUTES_API_KEY;
  else process.env.CHUTES_API_KEY = oldApiKey;
  rmSync(tempDir, { recursive: true, force: true });
}
