import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-planning-guard-"));
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
      requireCheckpointEveryTools: 1,
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
      enabled: false,
      model: "zai-org/GLM-4.7-Flash",
    },
    watchman: {
      enabled: false,
      inspectAssistantTurns: false,
      inspectToolCalls: false,
      inspectCompaction: false,
      inspectOnIdle: false,
      skipDuringPlanningAgent: true,
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
const logEntries = [];
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
      properties: { info: { id: "sess-plan-1" } },
    },
  });

  await hooks["tool.execute.after"](
    {
      tool: "edit",
      args: { filePath: "README.md" },
      sessionID: "sess-plan-1",
      agent: "plan",
    },
    {
      output: "planned next steps",
    }
  );

  const violation = logEntries.find((entry) => entry?.message === "law.violation.detected");
  if (violation) {
    console.error("FAIL  planning phase unexpectedly triggered deterministic violation");
    process.exit(1);
  }
  if (prompts.length > 0) {
    console.error("FAIL  planning phase unexpectedly injected interruption");
    process.exit(1);
  }

  console.log("PASS  planning agent is not interrupted by checkpoint debt");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
