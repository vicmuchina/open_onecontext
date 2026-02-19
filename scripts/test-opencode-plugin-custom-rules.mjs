import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-plugin-custom-rules-"));
mkdirSync(join(tempDir, ".GCC"), { recursive: true });
writeFileSync(
  join(tempDir, ".GCC", "law-enforcer.json"),
  JSON.stringify({
    version: 1,
    mode: "interrupt_continue",
    cooldowns: {
      interruptionSeconds: 5,
      sameRuleSeconds: 10,
    },
    limits: {
      maxConsecutiveInjections: 5,
    },
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
      enabled: false,
      model: "openai/gpt-oss-120b-TEE",
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
    custom: {
      enabled: true,
      policyFile: "law-policy.txt",
      escalation: {
        mode: "soft_then_hard",
        softViolationsBeforeInterrupt: 1,
        hardInterruptThreshold: 2,
        reminderCooldownSeconds: 0,
        resetOnCommit: true,
      },
      rules: [
        {
          id: "pty_required_for_dev_server",
          enabled: true,
          description: "Use PTY for npm run dev.",
          triggers: ["tool_call"],
          when: {
            commandIncludes: ["npm run dev"],
          },
          require: {
            anyTools: ["pty_spawn"],
            guidance: "Use pty_spawn for npm run dev.",
          },
          interruptAfterViolations: 2,
        },
      ],
      hints: {
        availableTools: ["pty_spawn"],
      },
    },
    observability: {
      traceEnabled: true,
      traceFile: "law-enforcer-trace.jsonl",
    },
  }),
  "utf-8"
);
writeFileSync(join(tempDir, ".GCC", "law-policy.txt"), "Rule: use PTY for long-running tasks.\n", "utf-8");

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
        info: { id: "sess-custom-1" },
      },
    },
  });

  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { cmd: "npm run dev" },
      sessionID: "sess-custom-1",
      agent: "build",
    },
    {
      output: "starting dev server...",
    }
  );

  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { cmd: "npm run dev" },
      sessionID: "sess-custom-1",
      agent: "build",
    },
    {
      output: "starting dev server...",
    }
  );

  const customViolationLog = logEntries.some(
    (entry) => entry?.message === "law.custom.violation.detected"
  );
  const customReminderLog = logEntries.some(
    (entry) => entry?.message === "law.custom.reminder"
  );
  const interruptionLog = logEntries.some((entry) => entry?.message === "law.interrupt.injected");
  const reminderToast = toasts.some((toast) =>
    String(toast?.message || "").includes("Law Enforcer reminder")
  );

  if (!customViolationLog) {
    console.error("FAIL  custom rule violation log not emitted");
    process.exit(1);
  }
  if (!customReminderLog) {
    console.error("FAIL  custom rule soft reminder log not emitted");
    process.exit(1);
  }
  if (!reminderToast) {
    console.error("FAIL  custom rule soft reminder toast missing");
    process.exit(1);
  }
  if (!interruptionLog) {
    console.error("FAIL  custom rule did not escalate to interruption");
    process.exit(1);
  }
  if (prompts.length < 1) {
    console.error("FAIL  interruption prompt was not injected");
    process.exit(1);
  }

  const tracePath = join(tempDir, ".GCC", "law-enforcer-trace.jsonl");
  const traceRows = readFileSync(tracePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const customTraceRows = traceRows.filter((row) => row.type === "law.custom.violation");
  if (customTraceRows.length < 2) {
    console.error("FAIL  custom rule violation traces were not captured");
    process.exit(1);
  }

  console.log("PASS  custom rule soft-then-hard escalation path");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
