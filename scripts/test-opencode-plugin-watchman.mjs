import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-plugin-watchman-"));
mkdirSync(join(tempDir, ".GCC"), { recursive: true });
writeFileSync(
  join(tempDir, ".GCC", "law-enforcer.yaml"),
  `version: 1
mode: interrupt_continue
cooldowns:
  interruptionSeconds: 5
  sameRuleSeconds: 10
limits:
  maxConsecutiveInjections: 3
gcc:
  requireInit: true
  requireCheckpointEveryTools: 6
  requireFailedAttemptLookup: true
  compactionCheckpointRequired: true
mcp:
  requireAwarenessAtSessionStart: false
  requireUseWhenRelevant: false
  usageReminderEveryTools: 4
research:
  requireCaptureOnDocsOrGithub: true
  docsKeywords: [docs, readme, documentation, arxiv.org]
critic:
  enabled: true
  provider: openai_compatible
  baseUrl: https://llm.chutes.ai/v1
  model: openai/gpt-oss-120b-TEE
  apiKeyEnv: OPENCONTEXT_LAW_API_KEY
  timeoutMs: 4000
watchman:
  enabled: true
  inspectAssistantTurns: true
  inspectToolCalls: false
  inspectCompaction: false
  includeRecentMessages: 8
  includeRecentToolCalls: 8
`,
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
            sessionID: "sess-watchman-1",
            role: "user",
          },
          parts: [{ type: "text", text: "test opencontext" }],
        },
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "sess-watchman-1",
            role: "assistant",
            finish: "stop",
            agent: "build",
            modelID: "zai-org/GLM-4.7-Flash",
            providerID: "chutes",
            time: {
              completed: new Date().toISOString(),
            },
          },
          parts: [{ type: "text", text: "I am continuing work without checking OpenContext." }],
        },
      ],
    }),
    promptAsync: async (payload) => {
      prompts.push(payload);
    },
  },
};

const oldFetch = global.fetch;
const oldApiKey = process.env.OPENCONTEXT_LAW_API_KEY;
process.env.OPENCONTEXT_LAW_API_KEY = "test-key";

global.fetch = async () => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            violation: true,
            rule: "gcc_checkpoint_required",
            reason: "Assistant ignored OpenContext workflow discipline.",
            correction_prompt:
              "OpenContext Law Enforcer interruption from watchman model: run `opencontext context --log --lines 80`, then `opencontext commit \"Checkpoint after watchman review\"`, then continue the task.",
            confidence: 0.93,
          }),
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
        info: { id: "sess-watchman-1" },
      },
    },
  });

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant-1",
          sessionID: "sess-watchman-1",
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

  const watchmanVerdictLog = logEntries.some((entry) => entry?.message === "law.watchman.verdict");
  const interruptionLog = logEntries.some((entry) => entry?.message === "law.interrupt.injected");
  const promptInjected = prompts.length > 0;
  const promptContainsWatchmanText =
    promptInjected &&
    String(prompts[0]?.body?.parts?.[0]?.text || "").includes("watchman model");

  if (!watchmanVerdictLog) {
    console.error("FAIL  watchman verdict log was not emitted");
    process.exit(1);
  }
  if (!interruptionLog) {
    console.error("FAIL  watchman interruption log was not emitted");
    process.exit(1);
  }
  if (!promptInjected) {
    console.error("FAIL  watchman interruption prompt was not injected");
    process.exit(1);
  }
  if (!promptContainsWatchmanText) {
    console.error("FAIL  injected prompt did not contain watchman-generated text");
    process.exit(1);
  }

  console.log("PASS  watchman assistant-turn interruption path");
} finally {
  global.fetch = oldFetch;
  if (oldApiKey == null) {
    delete process.env.OPENCONTEXT_LAW_API_KEY;
  } else {
    process.env.OPENCONTEXT_LAW_API_KEY = oldApiKey;
  }
  rmSync(tempDir, { recursive: true, force: true });
}
