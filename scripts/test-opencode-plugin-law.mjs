import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-plugin-law-"));
mkdirSync(join(tempDir, ".GCC"), { recursive: true });
writeFileSync(
  join(tempDir, ".GCC", "law-enforcer.yaml"),
  `version: 1
mode: interrupt_continue
cooldowns:
  interruptionSeconds: 5
  sameRuleSeconds: 20
limits:
  maxConsecutiveInjections: 3
gcc:
  requireInit: true
  requireCheckpointEveryTools: 2
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
  enabled: false
  provider: openai_compatible
  baseUrl: https://llm.chutes.ai/v1
  model: openai/gpt-oss-120b-TEE
  apiKeyEnv: OPENCONTEXT_LAW_API_KEY
  timeoutMs: 3500
`,
  "utf-8"
);

const logEntries = [];
const toasts = [];
const prompts = [];
const client = {
  app: {
    log: async ({ body }) => {
      logEntries.push(body);
    },
  },
  tui: {
    showToast: async ({ body }) => {
      toasts.push(body);
    },
  },
  session: {
    promptAsync: async (payload) => {
      prompts.push(payload);
    },
  },
};

try {
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const OpenContextPlugin = pluginModule.default;
  const hooks = await OpenContextPlugin({ client, directory: tempDir });

  await hooks.event({
    event: {
      type: "session.created",
      properties: {
        info: { id: "sess-law-1" },
      },
    },
  });

  await hooks["tool.execute.after"](
    {
      tool: "edit",
      args: { filePath: "src/main.js" },
      sessionID: "sess-law-1",
    },
    {
      output: "edited file",
    }
  );

  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { cmd: "npm test" },
      sessionID: "sess-law-1",
    },
    {
      output: "ok",
    }
  );

  const violationLogFound = logEntries.some((entry) => entry?.message === "law.violation.detected");
  const injectionLogFound = logEntries.some((entry) => entry?.message === "law.interrupt.injected");
  const promptInjected = prompts.length > 0;
  const promptContainsRule = promptInjected
    && String(prompts[0]?.body?.parts?.[0]?.text || "").includes("Rule violated:");

  if (!violationLogFound) {
    console.error("FAIL  law violation log was not emitted");
    process.exit(1);
  }
  if (!injectionLogFound) {
    console.error("FAIL  law interruption log was not emitted");
    process.exit(1);
  }
  if (!promptInjected) {
    console.error("FAIL  law interruption prompt was not injected");
    process.exit(1);
  }
  if (!promptContainsRule) {
    console.error("FAIL  injected prompt did not contain violation payload");
    process.exit(1);
  }

  console.log("PASS  law-enforcer interruption path");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
