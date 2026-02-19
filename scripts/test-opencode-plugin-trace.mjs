import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-plugin-trace-"));
const gccDir = join(tempDir, ".GCC");
mkdirSync(gccDir, { recursive: true });
writeFileSync(
  join(gccDir, "law-enforcer.json"),
  JSON.stringify({
    version: 1,
    mode: "interrupt_continue",
    cooldowns: {
      interruptionSeconds: 5,
      sameRuleSeconds: 10,
    },
    limits: {
      maxConsecutiveInjections: 3,
    },
    gcc: {
      requireInit: true,
      requireCheckpointEveryTools: 6,
      requireFailedAttemptLookup: true,
      compactionCheckpointRequired: true,
    },
    mcp: {
      requireAwarenessAtSessionStart: false,
      requireUseWhenRelevant: false,
      usageReminderEveryTools: 4,
    },
    research: {
      requireCaptureOnDocsOrGithub: true,
      docsKeywords: ["docs", "readme", "documentation", "arxiv.org"],
    },
    critic: {
      enabled: true,
      provider: "chutes",
      baseUrl: "https://llm.chutes.ai/v1",
      model: "openai/gpt-oss-120b-TEE",
      apiKeyEnv: "CHUTES_API_KEY",
      timeoutMs: 3000,
    },
    watchman: {
      enabled: true,
      inspectAssistantTurns: true,
      inspectToolCalls: true,
      inspectCompaction: false,
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
  join(gccDir, "law-policy.txt"),
  "Always use MCP tools when relevant and checkpoint research findings.\n",
  "utf-8"
);

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
            id: "msg-user-1",
            sessionID: "sess-trace-1",
            role: "user",
          },
          parts: [{ type: "text", text: "Run tests then continue" }],
        },
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "sess-trace-1",
            role: "assistant",
            finish: "stop",
            agent: "build",
            modelID: "zai-org/GLM-4.7-Flash",
            providerID: "chutes",
            time: {
              completed: new Date().toISOString(),
            },
          },
          parts: [{ type: "text", text: "I ran tools and completed." }],
        },
      ],
    }),
    promptAsync: async () => {},
  },
};

const oldFetch = global.fetch;
const oldApiKey = process.env.CHUTES_API_KEY;
process.env.CHUTES_API_KEY = "test-key";

global.fetch = async () => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: {
            violation: false,
            rule: "",
            reason: "No violation detected.",
            correction_prompt: "",
            confidence: 0.92,
          },
        },
      },
    ],
  }),
});

try {
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const OpenContextPlugin = pluginModule.default;
  const hooks = await OpenContextPlugin({ client, directory: tempDir });

  await hooks.event({
    event: {
      type: "session.created",
      properties: {
        info: { id: "sess-trace-1" },
      },
    },
  });

  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { cmd: "npm test" },
      sessionID: "sess-trace-1",
    },
    {
      output: "all tests passed",
    }
  );

  await hooks["tool.execute.after"](
    {
      tool: "edit",
      args: { filePath: "src/index.ts" },
      sessionID: "sess-trace-1",
    },
    {
      output: "edited file",
    }
  );

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant-1",
          sessionID: "sess-trace-1",
          role: "assistant",
          finish: "stop",
          agent: "build",
          providerID: "chutes",
          modelID: "zai-org/GLM-4.7-Flash",
          time: {
            completed: new Date().toISOString(),
          },
        },
      },
    },
  });

  const tracePath = join(gccDir, "law-enforcer-trace.jsonl");
  const lines = readFileSync(tracePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const hasToolTrace = lines.some(
    (entry) => entry.type === "tool.execute.after" && entry.tool?.name === "bash"
  );
  const requestTrace = lines.find((entry) => entry.type === "watchman.request");
  const responseTrace = lines.find((entry) => entry.type === "watchman.response");
  const requestHasToolEvidence =
    requestTrace &&
    Array.isArray(requestTrace.evidence?.recentToolCalls) &&
    requestTrace.evidence.recentToolCalls.length > 0;
  const requestHasPolicyText =
    requestTrace &&
    typeof requestTrace.evidence?.lawPolicyText === "string" &&
    requestTrace.evidence.lawPolicyText.includes("Always use MCP tools");

  if (!hasToolTrace) {
    console.error("FAIL  tool trace entry missing");
    process.exit(1);
  }
  if (!requestTrace) {
    console.error("FAIL  watchman request trace missing");
    process.exit(1);
  }
  if (!responseTrace) {
    console.error("FAIL  watchman response trace missing");
    process.exit(1);
  }
  if (!requestHasToolEvidence) {
    console.error("FAIL  watchman request trace missing recent tool evidence");
    process.exit(1);
  }
  if (!requestHasPolicyText) {
    console.error("FAIL  watchman request trace missing policy text evidence");
    process.exit(1);
  }

  console.log("PASS  watchman trace file captures request/response + tool evidence");
} finally {
  global.fetch = oldFetch;
  if (oldApiKey == null) delete process.env.CHUTES_API_KEY;
  else process.env.CHUTES_API_KEY = oldApiKey;
  rmSync(tempDir, { recursive: true, force: true });
}
