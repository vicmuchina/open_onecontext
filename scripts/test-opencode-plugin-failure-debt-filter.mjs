import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-failure-filter-"));
mkdirSync(join(tempDir, ".GCC"), { recursive: true });
writeFileSync(
  join(tempDir, ".GCC", "law-enforcer.json"),
  JSON.stringify({
    version: 1,
    mode: "interrupt_continue",
    cooldowns: { interruptionSeconds: 1, sameRuleSeconds: 1 },
    limits: { maxConsecutiveInjections: 10 },
    gcc: {
      requireInit: true,
      requireCheckpointEveryTools: 99,
      requireFailedAttemptLookup: true,
      failureLookupPolicyFile: "law-failure-policy.txt",
      failureClassifierEnabled: false,
      failureClassifierMinConfidence: 0.55,
      failureClassifierRequireModelDecision: false,
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
      enabled: false,
      model: "zai-org/GLM-4.7-Flash",
    },
    watchman: {
      enabled: false,
      dedupeSameViolationUntilResolved: true,
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
    messages: async () => ({ data: [] }),
  },
};

const oldNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => {
  fakeNow += 11_000; // pass min cooldown gates if dedupe is not working
  return fakeNow;
};

try {
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const OpenContextPlugin = pluginModule.default;
  const hooks = await OpenContextPlugin({ client, directory: tempDir });

  await hooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "sess-failure-filter-1" } },
    },
  });

  // 1) Noise failure should NOT open failed-attempt debt.
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { command: "cat missing.txt" },
      sessionID: "sess-failure-filter-1",
    },
    {
      output: "cat: missing.txt: No such file or directory",
    }
  );
  if (prompts.length !== 0) {
    console.error("FAIL  noise failure triggered failed-attempt interruption");
    process.exit(1);
  }

  // 2) Actionable failure should trigger exactly once.
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { command: "pytest app/tests/test_main_api.py" },
      sessionID: "sess-failure-filter-1",
    },
    {
      output: "FAILED app/tests/test_main_api.py::test_x",
    }
  );
  if (prompts.length !== 1) {
    console.error(`FAIL  expected first actionable failure to inject once, got ${prompts.length}`);
    process.exit(1);
  }

  // 3) Repeated actionable failure without lookup should be deduped.
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { command: "pytest app/tests/test_main_api.py -k test_x" },
      sessionID: "sess-failure-filter-1",
    },
    {
      output: "FAILED app/tests/test_main_api.py::test_x",
    }
  );
  if (prompts.length !== 1) {
    console.error("FAIL  duplicate failed-attempt interruption was not deduped");
    process.exit(1);
  }

  // 4) Required context lookup clears debt.
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { command: 'opencontext context --search "test_x" --limit 20' },
      sessionID: "sess-failure-filter-1",
    },
    {
      output: "Search results for test_x",
    }
  );

  // 5) New actionable failure should inject again after debt clear.
  await hooks["tool.execute.after"](
    {
      tool: "bash",
      args: { command: "pytest app/tests/test_main_api.py -k test_x" },
      sessionID: "sess-failure-filter-1",
    },
    {
      output: "FAILED app/tests/test_main_api.py::test_x",
    }
  );
  if (prompts.length !== 2) {
    console.error(`FAIL  expected second injection after debt clear, got ${prompts.length}`);
    process.exit(1);
  }

  const dedupeLogFound = logEntries.some((entry) => entry?.message === "law.interrupt.skipped_open_debt");
  if (!dedupeLogFound) {
    console.error("FAIL  dedupe skip log was not emitted");
    process.exit(1);
  }

  console.log("PASS  failure noise filter + unresolved-debt dedupe behavior");
} finally {
  Date.now = oldNow;
  rmSync(tempDir, { recursive: true, force: true });
}
