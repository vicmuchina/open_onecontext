import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-provider-config-"));
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
      baseUrl: "https://provider.example/v2",
      endpointPath: "chat/completions",
      authHeader: "x-api-key",
      apiKeyPrefix: "",
      headers: {
        "x-org-id": "acme",
      },
      request: {
        temperature: 0,
      },
      model: "provider/model-fast",
      apiKeyEnv: "LAW_PROVIDER_KEY",
      timeoutMs: 3000,
      maxTokensWatchman: 180,
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

const prompts = [];
const requests = [];

const client = {
  app: {
    log: async () => {},
  },
  tui: {
    showToast: async () => {},
  },
  session: {
    messages: async () => ({
      data: [
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "sess-provider-1",
            role: "assistant",
            finish: "stop",
            agent: "build",
            providerID: "provider",
            modelID: "provider/model-fast",
            time: { completed: new Date().toISOString() },
          },
          parts: [{ type: "text", text: "Working..." }],
        },
      ],
    }),
    promptAsync: async (payload) => {
      prompts.push(payload);
    },
  },
};

const oldFetch = global.fetch;
const oldKey = process.env.LAW_PROVIDER_KEY;
process.env.LAW_PROVIDER_KEY = "provider-test-key";

global.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              violation: false,
              rule: "",
              reason: "compliant",
              correction_prompt: "",
              confidence: 0.96,
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
      properties: { info: { id: "sess-provider-1" } },
    },
  });

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant-1",
          sessionID: "sess-provider-1",
          role: "assistant",
          finish: "stop",
          agent: "build",
          providerID: "provider",
          modelID: "provider/model-fast",
          time: { completed: new Date().toISOString() },
        },
      },
    },
  });

  if (requests.length === 0) {
    console.error("FAIL  provider call was not made");
    process.exit(1);
  }

  const req = requests[0];
  const headers = req.options?.headers || {};
  const body = JSON.parse(String(req.options?.body || "{}"));

  if (String(req.url) !== "https://provider.example/v2/chat/completions") {
    console.error(`FAIL  unexpected endpoint: ${req.url}`);
    process.exit(1);
  }
  if (headers["x-api-key"] !== "provider-test-key") {
    console.error("FAIL  custom auth header not applied");
    process.exit(1);
  }
  if (headers["x-org-id"] !== "acme") {
    console.error("FAIL  custom headers not applied");
    process.exit(1);
  }
  if (body?.response_format?.type !== "json_schema") {
    console.error("FAIL  response_format json_schema missing");
    process.exit(1);
  }
  if (body?.response_format?.json_schema?.name !== "opencontext_watchman") {
    console.error("FAIL  watchman schema name missing");
    process.exit(1);
  }
  if (prompts.length !== 0) {
    console.error("FAIL  non-violation unexpectedly injected prompt");
    process.exit(1);
  }

  console.log("PASS  provider-agnostic OpenAI-compatible config is applied");
} finally {
  global.fetch = oldFetch;
  if (oldKey == null) delete process.env.LAW_PROVIDER_KEY;
  else process.env.LAW_PROVIDER_KEY = oldKey;
  rmSync(tempDir, { recursive: true, force: true });
}
