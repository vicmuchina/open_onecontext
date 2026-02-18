/**
 * OpenContext Law Enforcer Plugin for OpenCode
 *
 * Keeps original plugin file name for compatibility while upgrading behavior from
 * advisory reminders to continuous, interrupt-and-continue enforcement.
 */

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG = {
  contextWarningThreshold: 80,
  researchReminderCooldownMs: 30000,
  gccDir: ".GCC",
  lawFileNameJson: "law-enforcer.json",
  lawFileNameYaml: "law-enforcer.yaml",
  traceFileName: "law-enforcer-trace.jsonl",
  logService: "opencontext.plugin",
  contextCacheMs: 15000,
  lawCacheMs: 5000,
  maxRecentTools: 12,
  maxRecentToolExecutions: 24,
  maxSnippetChars: 1200,
};

const DEFAULT_LAW = {
  version: 1,
  mode: "interrupt_continue",
  cooldowns: {
    interruptionSeconds: 45,
    sameRuleSeconds: 120,
  },
  limits: {
    maxConsecutiveInjections: 4,
  },
  gcc: {
    requireInit: true,
    requireCheckpointEveryTools: 6,
    requireFailedAttemptLookup: true,
    compactionCheckpointRequired: true,
    skipCheckpointDuringPlanningAgent: true,
    countReadOnlyToolsForCheckpoint: false,
  },
  mcp: {
    requireAwarenessAtSessionStart: true,
    requireUseWhenRelevant: true,
    usageReminderEveryTools: 4,
  },
  research: {
    requireCaptureOnDocsOrGithub: true,
    docsKeywords: ["docs", "readme", "documentation", "arxiv.org"],
  },
  critic: {
    enabled: true,
    provider: "openai_compatible",
    baseUrl: "https://llm.chutes.ai/v1",
    endpointPath: "/chat/completions",
    authHeader: "authorization",
    apiKeyPrefix: "Bearer",
    headers: {},
    request: {},
    model: "openai/gpt-oss-120b-TEE",
    apiKeyEnv: "CHUTES_API_KEY",
    modelEnv: "OPENCONTEXT_LAW_MODEL_ID",
    timeoutMs: 8000,
    maxTokensCritic: 120,
    maxTokensWatchman: 320,
  },
  watchman: {
    enabled: true,
    inspectAssistantTurns: true,
    inspectToolCalls: true,
    inspectCompaction: true,
    inspectOnIdle: true,
    skipDuringPlanningAgent: true,
    includeRecentMessages: 12,
    includeRecentToolCalls: 12,
  },
  observability: {
    traceEnabled: true,
    traceFile: "law-enforcer-trace.jsonl",
  },
};

const sessionStateById = new Map();
let activeSessionId = "";
let lastContextWarningPercent = 0;
let messageUpdateCount = 0;
let contextCache = {
  fetchedAt: 0,
  data: null,
};
let lawCache = {
  fetchedAt: 0,
  path: "",
  data: null,
};
let mcpNamesCache = {
  fetchedAt: 0,
  data: [],
};

const CRITIC_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["enforce", "reason"],
  properties: {
    enforce: { type: "boolean" },
    reason: { type: "string" },
  },
};

const WATCHMAN_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["violation", "rule", "reason", "correction_prompt", "confidence"],
  properties: {
    violation: { type: "boolean" },
    rule: { type: "string" },
    reason: { type: "string" },
    correction_prompt: { type: "string" },
    confidence: { type: "number" },
  },
};

function getSessionState(sessionId) {
  const resolvedSessionId = sessionId || "__default__";
  if (!sessionStateById.has(resolvedSessionId)) {
    sessionStateById.set(resolvedSessionId, {
      sessionId: resolvedSessionId,
      toolExecutionCount: 0,
      sinceCommitCount: 0,
      lastInjectionAt: 0,
      lastRuleInjectionAt: {},
      consecutiveInjections: 0,
      lastResearchReminderTime: 0,
      pendingCompactionCheckpoint: false,
      pendingResearchCapture: false,
      pendingFailureLookup: false,
      mcpUsed: false,
      recentTools: [],
      recentToolExecutions: [],
      lastAgent: undefined,
      lastModel: undefined,
      hasViolationDebt: false,
      inspectorInFlight: false,
      lastInspectedAssistantMessageId: "",
      lastAssistantMessageId: "",
      lastAssistantText: "",
    });
  }
  return sessionStateById.get(resolvedSessionId);
}

function appendRecentTool(state, tool) {
  state.recentTools.push(tool);
  if (state.recentTools.length > CONFIG.maxRecentTools) {
    state.recentTools.shift();
  }
}

function clipText(value, max = CONFIG.maxSnippetChars) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function safeJsonString(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value ?? "");
  }
}

function appendRecentToolExecution(state, payload) {
  state.recentToolExecutions.push(payload);
  if (state.recentToolExecutions.length > CONFIG.maxRecentToolExecutions) {
    state.recentToolExecutions.shift();
  }
}

function extractMessageText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function summarizeMessage(message) {
  const info = message?.info || {};
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = extractMessageText(parts);
  return {
    id: info.id || "",
    role: info.role || "unknown",
    agent: info.agent || "",
    modelID: info.modelID || info?.model?.modelID || "",
    finish: info.finish || "",
    text: clipText(text),
    partTypes: parts.map((part) => part?.type || "unknown").slice(0, 20),
    time: info.time || {},
  };
}

function hasAssistantCompletion(info) {
  if (!info || info.role !== "assistant") return false;
  if (info.finish) return true;
  const completed = info?.time?.completed;
  return Boolean(completed);
}

function isGCCInitialized(directory) {
  return existsSync(join(directory, CONFIG.gccDir));
}

function parseBranchFromStatus(statusText) {
  const match = statusText.match(/Current branch:\s+(.+)/);
  return match ? match[1].trim() : "unknown";
}

function parseLastCommitFromStatus(statusText) {
  const match = statusText.match(/Last commit:\s+(.+)/);
  return match ? match[1].trim() : "none";
}

function toToolName(toolLike) {
  if (typeof toolLike === "string") return toolLike;
  if (toolLike && typeof toolLike.id === "string") return toolLike.id;
  if (toolLike && typeof toolLike.name === "string") return toolLike.name;
  return "unknown";
}

function toLowerSafe(value) {
  return String(value ?? "").toLowerCase();
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s"'`)<>\]]+/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function shallowClone(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return [...value];
  return { ...value };
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return shallowClone(base);
  const output = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === "object" &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = shallowClone(value);
    }
  }
  return output;
}

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (!value) return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => {
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          return v.slice(1, -1);
        }
        return v;
      });
  }
  return value;
}

function parseYamlLike(content) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^(\s*)([^:#][^:]*):\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const raw = match[3];

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;
    if (!raw.trim()) {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
    } else {
      parent[key] = parseScalar(raw);
    }
  }
  return root;
}

function sanitizeLaw(law) {
  const sanitized = deepMerge(DEFAULT_LAW, law || {});
  if (!Number.isFinite(sanitized.gcc.requireCheckpointEveryTools)) {
    sanitized.gcc.requireCheckpointEveryTools = DEFAULT_LAW.gcc.requireCheckpointEveryTools;
  }
  sanitized.gcc.requireCheckpointEveryTools = Math.max(
    2,
    Math.min(50, Math.round(sanitized.gcc.requireCheckpointEveryTools))
  );
  if (!Number.isFinite(sanitized.mcp.usageReminderEveryTools)) {
    sanitized.mcp.usageReminderEveryTools = DEFAULT_LAW.mcp.usageReminderEveryTools;
  }
  sanitized.mcp.usageReminderEveryTools = Math.max(
    2,
    Math.min(25, Math.round(sanitized.mcp.usageReminderEveryTools))
  );
  sanitized.cooldowns.interruptionSeconds = Math.max(
    5,
    Math.min(1800, Number(sanitized.cooldowns.interruptionSeconds || 45))
  );
  sanitized.cooldowns.sameRuleSeconds = Math.max(
    10,
    Math.min(3600, Number(sanitized.cooldowns.sameRuleSeconds || 120))
  );
  sanitized.limits.maxConsecutiveInjections = Math.max(
    1,
    Math.min(20, Number(sanitized.limits.maxConsecutiveInjections || 4))
  );
  sanitized.gcc.skipCheckpointDuringPlanningAgent =
    sanitized.gcc.skipCheckpointDuringPlanningAgent !== false;
  sanitized.gcc.countReadOnlyToolsForCheckpoint =
    sanitized.gcc.countReadOnlyToolsForCheckpoint === true;
  if (!sanitized.critic.provider || typeof sanitized.critic.provider !== "string") {
    sanitized.critic.provider = "openai_compatible";
  }
  if (!sanitized.critic.baseUrl || typeof sanitized.critic.baseUrl !== "string") {
    sanitized.critic.baseUrl = DEFAULT_LAW.critic.baseUrl;
  }
  if (!sanitized.critic.endpointPath || typeof sanitized.critic.endpointPath !== "string") {
    sanitized.critic.endpointPath = DEFAULT_LAW.critic.endpointPath;
  }
  sanitized.critic.endpointPath = `/${sanitized.critic.endpointPath.replace(/^\/+/, "")}`;
  if (!sanitized.critic.authHeader || typeof sanitized.critic.authHeader !== "string") {
    sanitized.critic.authHeader = DEFAULT_LAW.critic.authHeader;
  }
  if (typeof sanitized.critic.apiKeyPrefix !== "string") {
    sanitized.critic.apiKeyPrefix = DEFAULT_LAW.critic.apiKeyPrefix;
  }
  if (!sanitized.critic.headers || typeof sanitized.critic.headers !== "object") {
    sanitized.critic.headers = {};
  }
  if (!sanitized.critic.request || typeof sanitized.critic.request !== "object") {
    sanitized.critic.request = {};
  }
  sanitized.critic.timeoutMs = Math.max(
    500,
    Math.min(20000, Number(sanitized.critic.timeoutMs || 8000))
  );
  sanitized.critic.maxTokensCritic = Math.max(
    32,
    Math.min(2000, Number(sanitized.critic.maxTokensCritic || 120))
  );
  sanitized.critic.maxTokensWatchman = Math.max(
    64,
    Math.min(4000, Number(sanitized.critic.maxTokensWatchman || 320))
  );
  if (!sanitized.critic.apiKeyEnv || typeof sanitized.critic.apiKeyEnv !== "string") {
    sanitized.critic.apiKeyEnv = "CHUTES_API_KEY";
  }
  if (!sanitized.critic.model || typeof sanitized.critic.model !== "string") {
    sanitized.critic.model = DEFAULT_LAW.critic.model;
  }
  sanitized.watchman.enabled = sanitized.watchman.enabled !== false;
  sanitized.watchman.inspectAssistantTurns = sanitized.watchman.inspectAssistantTurns !== false;
  sanitized.watchman.inspectToolCalls = sanitized.watchman.inspectToolCalls !== false;
  sanitized.watchman.inspectCompaction = sanitized.watchman.inspectCompaction !== false;
  sanitized.watchman.inspectOnIdle = sanitized.watchman.inspectOnIdle !== false;
  sanitized.watchman.skipDuringPlanningAgent = sanitized.watchman.skipDuringPlanningAgent !== false;
  sanitized.watchman.includeRecentMessages = Math.max(
    2,
    Math.min(50, Number(sanitized.watchman.includeRecentMessages || 12))
  );
  sanitized.watchman.includeRecentToolCalls = Math.max(
    2,
    Math.min(50, Number(sanitized.watchman.includeRecentToolCalls || 12))
  );
  sanitized.observability = sanitized.observability && typeof sanitized.observability === "object"
    ? sanitized.observability
    : {};
  sanitized.observability.traceEnabled = sanitized.observability.traceEnabled !== false;
  if (
    !sanitized.observability.traceFile ||
    typeof sanitized.observability.traceFile !== "string"
  ) {
    sanitized.observability.traceFile = CONFIG.traceFileName;
  }
  if (!Array.isArray(sanitized.research.docsKeywords)) {
    sanitized.research.docsKeywords = [...DEFAULT_LAW.research.docsKeywords];
  }
  return sanitized;
}

function getLawPaths(directory) {
  return [
    join(directory, CONFIG.gccDir, CONFIG.lawFileNameJson),
    join(directory, CONFIG.gccDir, CONFIG.lawFileNameYaml),
  ];
}

async function loadLaw(client, directory) {
  const lawPaths = getLawPaths(directory);
  const lawPath = lawPaths.find((path) => existsSync(path)) || lawPaths[0];
  if (
    lawCache.data &&
    lawCache.path === lawPath &&
    Date.now() - lawCache.fetchedAt < CONFIG.lawCacheMs
  ) {
    return lawCache.data;
  }

  let parsed = {};
  if (existsSync(lawPath)) {
    try {
      const raw = readFileSync(lawPath, "utf-8");
      if (lawPath.endsWith(".json")) {
        parsed = JSON.parse(raw);
      } else {
        parsed = parseYamlLike(raw);
      }
      await log(client, "debug", "law.loaded", { lawPath, format: lawPath.endsWith(".json") ? "json" : "yaml" });
    } catch (error) {
      await log(client, "warn", "law.load_failed", {
        lawPath,
        error: error?.message ?? String(error),
      });
    }
  } else {
    await log(client, "debug", "law.default_used", { lawPath });
  }
  const law = sanitizeLaw(parsed);
  lawCache = {
    fetchedAt: Date.now(),
    path: lawPath,
    data: law,
  };
  return law;
}

async function appendLawTrace(client, directory, law, record) {
  if (!law?.observability?.traceEnabled) return;
  const fileName = law?.observability?.traceFile || CONFIG.traceFileName;
  const tracePath = join(directory, CONFIG.gccDir, fileName);
  const payload = {
    at: new Date().toISOString(),
    ...record,
  };
  try {
    appendFileSync(tracePath, `${JSON.stringify(payload)}\n`, "utf-8");
  } catch (error) {
    await log(client, "debug", "law.trace_write_failed", {
      tracePath,
      error: error?.message ?? String(error),
    });
  }
}

async function log(client, level, message, extra = {}) {
  try {
    await client.app.log({
      body: {
        service: CONFIG.logService,
        level,
        message,
        extra,
      },
    });
  } catch {
    // Keep plugin non-blocking.
  }
}

async function toast(client, payload) {
  try {
    const variant = payload.type ?? "info";
    const duration = payload.timeout ?? 5000;
    await client.tui.showToast({
      body: {
        title: payload.title,
        message: payload.message,
        variant,
        duration,
      },
    });
  } catch (error) {
    await log(client, "debug", "toast unavailable", {
      error: error?.message ?? String(error),
    });
  }
}

function extractSessionIdFromEvent(event) {
  const props = event?.properties || {};
  const info = props.info || {};
  return (
    props.sessionID ||
    info.sessionID ||
    info.id ||
    ""
  );
}

function extractCommandFromArgs(args) {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  if (typeof args.command === "string") return args.command;
  if (typeof args.cmd === "string") return args.cmd;
  if (typeof args.input === "string") return args.input;
  if (typeof args.script === "string") return args.script;
  if (Array.isArray(args.command)) return args.command.join(" ");
  return JSON.stringify(args);
}

function isOpenContextInitCommand(commandText) {
  const text = toLowerSafe(commandText);
  return (text.includes("opencontext") || text.includes("ocx")) && text.includes(" init");
}

function isOpenContextCommitCommand(commandText) {
  const text = toLowerSafe(commandText);
  return (text.includes("opencontext") || text.includes("ocx")) && text.includes(" commit");
}

function isOpenContextContextLookup(commandText) {
  const text = toLowerSafe(commandText);
  return (
    (text.includes("opencontext") || text.includes("ocx")) &&
    text.includes(" context") &&
    (text.includes("--search") || text.includes("--log"))
  );
}

function isMcpTool(toolName) {
  return toLowerSafe(toolName).startsWith("mcp__");
}

function detectResearchSignal(tool, args, toolOutput, law) {
  const toolName = toLowerSafe(tool);
  const isResearchTool =
    toolName.includes("webfetch") ||
    toolName.includes("google_search") ||
    toolName.includes("websearch") ||
    toolName.includes("search") ||
    toolName.includes("context7") ||
    toolName.startsWith("mcp__");
  if (!isResearchTool) return null;

  const argBlob = typeof args === "string" ? args : JSON.stringify(args || {});
  const outputBlob = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput || {});
  const corpus = `${argBlob}\n${outputBlob}`.toLowerCase();

  const hasGithub = corpus.includes("github.com");
  const hasDocs = law.research.docsKeywords.some((kw) => corpus.includes(toLowerSafe(kw)));
  if (!hasGithub && !hasDocs) return null;

  return {
    sourceType: hasGithub && hasDocs ? "github+docs" : hasGithub ? "github" : "docs",
    urls: extractUrls(`${argBlob}\n${outputBlob}`).slice(0, 3),
  };
}

function detectFailureSignal(tool, output) {
  const toolName = toLowerSafe(tool);
  if (toolName.includes("read")) return false;
  const blob = typeof output === "string" ? output : JSON.stringify(output || {});
  const text = toLowerSafe(blob);
  return (
    text.includes("error") ||
    text.includes("failed") ||
    text.includes("traceback") ||
    text.includes("exception") ||
    text.includes("assertionerror") ||
    text.includes("test failed")
  );
}

function isPlanningAgentName(agent) {
  const text = toLowerSafe(agent);
  return text.includes("plan");
}

function isLikelyReadOnlyBashCommand(commandText) {
  const text = String(commandText || "").trim().toLowerCase();
  if (!text) return false;

  const mutatingSignals = [
    "npm install",
    "pip install",
    "poetry add",
    "pnpm add",
    "yarn add",
    "git commit",
    "git push",
    "git merge",
    "git rebase",
    "git cherry-pick",
    "opencontext commit",
    "pytest",
    "npm test",
    "pnpm test",
    "yarn test",
    "cargo test",
    "go test",
    "python",
    "node ",
    "make",
    "docker build",
    "docker run",
  ];
  if (mutatingSignals.some((signal) => text.includes(signal))) return false;

  const readonlyPrefixes = [
    "pwd",
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "echo",
    "printf",
    "which",
    "type",
    "find",
    "rg",
    "grep",
    "sed -n",
    "git status",
    "git diff",
    "git log",
    "opencontext context",
    "opencontext status",
    "opencontext list",
  ];
  return readonlyPrefixes.some((prefix) => text.startsWith(prefix));
}

function shouldIncrementCheckpointDebt({ law, state, tool, commandText }) {
  const t = toLowerSafe(tool);
  if (isOpenContextCommitCommand(commandText) || isOpenContextContextLookup(commandText)) {
    return false;
  }
  if (
    law?.gcc?.skipCheckpointDuringPlanningAgent &&
    isPlanningAgentName(state?.lastAgent)
  ) {
    return false;
  }
  if (t.includes("bash")) {
    if (law?.gcc?.countReadOnlyToolsForCheckpoint === true) {
      return true;
    }
    return !isLikelyReadOnlyBashCommand(commandText);
  }
  return (
    t.includes("edit") ||
    t.includes("write") ||
    t.includes("multiedit")
  );
}

async function getGCCContext(directory, client) {
  try {
    const { execSync } = await import("child_process");
    const context = execSync("opencontext context", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
    });
    const status = execSync("opencontext status", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
    });
    return { context, status };
  } catch (error) {
    await log(client, "warn", "opencontext CLI lookup failed", {
      directory,
      error: error?.message ?? String(error),
    });
    return null;
  }
}

async function getCachedGCCContext(directory, client) {
  if (
    contextCache.data &&
    Date.now() - contextCache.fetchedAt < CONFIG.contextCacheMs
  ) {
    return contextCache.data;
  }
  const data = await getGCCContext(directory, client);
  if (data) {
    contextCache = {
      fetchedAt: Date.now(),
      data,
    };
  }
  return data;
}

async function getSessionMessages(client, sessionId) {
  if (!sessionId || !client?.session?.messages) return [];
  try {
    const result = await client.session.messages({
      path: { id: sessionId },
    });
    return Array.isArray(result?.data) ? result.data : [];
  } catch (error) {
    await log(client, "debug", "law.session_messages_failed", {
      sessionId,
      error: error?.message ?? String(error),
    });
    return [];
  }
}

async function collectWatchmanEvidence(client, law, state) {
  const sessionId = state?.sessionId || activeSessionId;
  const messages = await getSessionMessages(client, sessionId);
  const recent = messages.slice(-law.watchman.includeRecentMessages);
  const summarized = recent.map(summarizeMessage);
  const assistants = summarized.filter((msg) => msg.role === "assistant");
  const latestAssistant = assistants.length > 0 ? assistants[assistants.length - 1] : null;
  if (latestAssistant) {
    state.lastAssistantMessageId = latestAssistant.id || state.lastAssistantMessageId;
    state.lastAssistantText = latestAssistant.text || state.lastAssistantText;
    if (!state.lastAgent && latestAssistant.agent) state.lastAgent = latestAssistant.agent;
  }

  const recentToolCalls = state.recentToolExecutions.slice(-law.watchman.includeRecentToolCalls);
  return {
    sessionId,
    recentMessages: summarized,
    latestAssistant,
    recentToolCalls,
    debts: {
      pendingCompactionCheckpoint: state.pendingCompactionCheckpoint,
      pendingResearchCapture: state.pendingResearchCapture,
      pendingFailureLookup: state.pendingFailureLookup,
      sinceCommitCount: state.sinceCommitCount,
      toolExecutionCount: state.toolExecutionCount,
      mcpUsed: state.mcpUsed,
    },
  };
}

function buildLawSummaryForInspector(law) {
  return {
    mode: law.mode,
    gcc: law.gcc,
    mcp: law.mcp,
    research: law.research,
    watchman: {
      enabled: law.watchman.enabled,
      inspectAssistantTurns: law.watchman.inspectAssistantTurns,
      inspectToolCalls: law.watchman.inspectToolCalls,
      inspectCompaction: law.watchman.inspectCompaction,
      inspectOnIdle: law.watchman.inspectOnIdle,
      skipDuringPlanningAgent: law.watchman.skipDuringPlanningAgent,
    },
  };
}

function buildViolationPrompt({ rule, detail, commands }) {
  const commandBlock = commands.length > 0
    ? commands.map((cmd) => `- ${cmd}`).join("\n")
    : "- Continue with compliant workflow";
  return [
    "OpenContext Law Enforcer interruption:",
    `Rule violated: ${rule}`,
    `Reason: ${detail}`,
    "",
    "Do these before continuing normal work:",
    commandBlock,
    "",
    "After completing the required actions, continue implementation.",
  ].join("\n");
}

async function injectContinuation(client, directory, state, text) {
  const sessionId = state?.sessionId || activeSessionId;
  if (!sessionId) return false;

  const body = {
    parts: [{ type: "text", text }],
  };
  if (state?.lastAgent) body.agent = state.lastAgent;
  if (state?.lastModel) body.model = state.lastModel;

  try {
    if (client?.session?.promptAsync) {
      await client.session.promptAsync({
        path: { id: sessionId },
        body,
        query: { directory },
      });
      return true;
    }
    if (client?.session?.prompt) {
      await client.session.prompt({
        path: { id: sessionId },
        body,
        query: { directory },
      });
      return true;
    }
    return false;
  } catch (error) {
    await log(client, "warn", "law.inject_failed", {
      sessionId,
      error: error?.message ?? String(error),
    });
    return false;
  }
}

async function getAvailableMcpNames() {
  if (Date.now() - mcpNamesCache.fetchedAt < 15000 && mcpNamesCache.data.length > 0) {
    return mcpNamesCache.data;
  }
  try {
    const configPath = join(homedir(), ".config", "opencode", "opencode.json");
    if (!existsSync(configPath)) return [];
    const raw = readFileSync(configPath, "utf-8");
    const json = JSON.parse(raw);
    const mcp = json?.mcp || {};
    const names = Object.entries(mcp)
      .filter(([, config]) => config && config.enabled !== false)
      .map(([name]) => name)
      .slice(0, 10);
    mcpNamesCache = {
      fetchedAt: Date.now(),
      data: names,
    };
    return names;
  } catch {
    return [];
  }
}

function resolveCriticApiKey(law) {
  const orderedEnvNames = [];
  if (typeof law?.critic?.apiKeyEnv === "string" && law.critic.apiKeyEnv.trim()) {
    orderedEnvNames.push(law.critic.apiKeyEnv.trim());
  } else if (Array.isArray(law?.critic?.apiKeyEnv)) {
    for (const name of law.critic.apiKeyEnv) {
      if (typeof name === "string" && name.trim()) {
        orderedEnvNames.push(name.trim());
      }
    }
  }
  orderedEnvNames.push("CHUTES_API_KEY", "OPENAI_API_KEY", "OPENCONTEXT_LAW_API_KEY");

  for (const envName of orderedEnvNames) {
    const value = process.env[envName];
    if (value && value.trim()) {
      return { apiKey: value.trim(), sourceEnv: envName };
    }
  }
  return { apiKey: "", sourceEnv: "" };
}

function resolveCriticModel(law) {
  const modelEnv = typeof law?.critic?.modelEnv === "string" ? law.critic.modelEnv.trim() : "";
  if (modelEnv && process.env[modelEnv]?.trim()) {
    return process.env[modelEnv].trim();
  }
  return law?.critic?.model || DEFAULT_LAW.critic.model;
}

function resolveCriticEndpoint(law) {
  const baseUrl = String(law?.critic?.baseUrl || DEFAULT_LAW.critic.baseUrl).replace(/\/+$/, "");
  const endpointPath = `/${String(law?.critic?.endpointPath || DEFAULT_LAW.critic.endpointPath).replace(/^\/+/, "")}`;
  return `${baseUrl}${endpointPath}`;
}

function buildCriticHeaders(law, apiKey) {
  const headers = {
    "content-type": "application/json",
  };
  const customHeaders = law?.critic?.headers && typeof law.critic.headers === "object"
    ? law.critic.headers
    : {};
  for (const [key, value] of Object.entries(customHeaders)) {
    if (typeof key === "string" && key.trim() && value != null) {
      headers[key] = String(value);
    }
  }
  if (apiKey) {
    const authHeader = String(law?.critic?.authHeader || DEFAULT_LAW.critic.authHeader).trim();
    if (authHeader) {
      const prefix = String(law?.critic?.apiKeyPrefix ?? DEFAULT_LAW.critic.apiKeyPrefix).trim();
      headers[authHeader] = prefix ? `${prefix} ${apiKey}` : apiKey;
    }
  }
  return headers;
}

function buildStructuredResponseFormat(schemaName, schema) {
  return {
    type: "json_schema",
    json_schema: {
      name: schemaName,
      strict: true,
      schema,
    },
  };
}

function tryParseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractMessageTextForDebug(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") return safeJsonString(content);
  return safeJsonString(message);
}

function extractStructuredObjectFromCompletion(data) {
  const message = data?.choices?.[0]?.message || {};
  const candidates = [];

  if (message.parsed && typeof message.parsed === "object" && !Array.isArray(message.parsed)) {
    candidates.push(message.parsed);
  }

  const content = message.content;
  if (typeof content === "string") {
    const parsed = tryParseJsonObject(content);
    if (parsed) candidates.push(parsed);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") {
        const parsed = tryParseJsonObject(part);
        if (parsed) candidates.push(parsed);
        continue;
      }
      if (!part || typeof part !== "object") continue;
      const fromPart = tryParseJsonObject(part);
      if (fromPart) candidates.push(fromPart);
      const text = typeof part.text === "string" ? part.text : "";
      const parsedText = tryParseJsonObject(text);
      if (parsedText) candidates.push(parsedText);
      if (typeof part.output_text === "string") {
        const parsedOutputText = tryParseJsonObject(part.output_text);
        if (parsedOutputText) candidates.push(parsedOutputText);
      }
    }
  } else if (content && typeof content === "object") {
    candidates.push(content);
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    const args = call?.function?.arguments;
    const parsedArgs = tryParseJsonObject(args);
    if (parsedArgs) candidates.push(parsedArgs);
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildLawModelRequest({ law, model, messages, maxTokens, schemaName, schema }) {
  const requestOverrides = law?.critic?.request && typeof law.critic.request === "object"
    ? law.critic.request
    : {};
  const body = {
    ...requestOverrides,
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: buildStructuredResponseFormat(schemaName, schema),
  };
  return body;
}

async function callLawModel({ law, apiKey, model, timeoutMs, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = resolveCriticEndpoint(law);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildCriticHeaders(law, apiKey),
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        raw: clipText(raw, 500),
      };
    }
    const data = await response.json();
    return {
      ok: true,
      data,
      parsed: extractStructuredObjectFromCompletion(data),
      raw: clipText(extractMessageTextForDebug(data?.choices?.[0]?.message || {}), 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runCriticCheck(client, law, payload) {
  if (!law.critic.enabled) return { enforce: true, source: "disabled" };
  const { apiKey, sourceEnv } = resolveCriticApiKey(law);
  if (!apiKey) return { enforce: true, source: "no_api_key" };
  const model = resolveCriticModel(law);

  try {
    const result = await callLawModel({
      law,
      apiKey,
      model,
      timeoutMs: law.critic.timeoutMs || 3500,
      body: buildLawModelRequest({
        law,
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an OpenContext law gate. Respond in strict JSON schema only.",
          },
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
        maxTokens: law.critic.maxTokensCritic || 120,
        schemaName: "opencontext_critic",
        schema: CRITIC_RESPONSE_SCHEMA,
      }),
    });
    if (!result.ok) {
      return {
        enforce: true,
        source: "http_error",
        status: result.status,
        raw: result.raw,
        apiKeyEnv: sourceEnv,
      };
    }
    const parsed = result.parsed;
    if (!parsed) {
      return {
        enforce: true,
        source: "parse_invalid_json",
        raw: result.raw,
        apiKeyEnv: sourceEnv,
      };
    }
    if (typeof parsed.enforce !== "boolean") {
      return {
        enforce: true,
        source: "parse_invalid_shape",
        raw: clipText(safeJsonString(parsed), 500),
        apiKeyEnv: sourceEnv,
      };
    }
    const enforce = parsed?.enforce !== false;
    return { enforce, source: "critic", reason: parsed?.reason || "" };
  } catch (error) {
    return {
      enforce: true,
      source: "critic_error",
      error: error?.message ?? String(error),
      apiKeyEnv: sourceEnv,
    };
  }
}

async function runWatchmanCheck(client, law, payload) {
  if (!law.watchman.enabled) {
    return { available: false, violation: false, source: "watchman_disabled" };
  }
  if (!law.critic.enabled) {
    return { available: false, violation: false, source: "critic_disabled" };
  }

  const { apiKey, sourceEnv } = resolveCriticApiKey(law);
  if (!apiKey) {
    return { available: false, violation: false, source: "no_api_key" };
  }
  const model = resolveCriticModel(law);

  try {
    const result = await callLawModel({
      law,
      apiKey,
      model,
      timeoutMs: law.critic.timeoutMs || 8000,
      body: buildLawModelRequest({
        law,
        model,
        messages: [
          {
            role: "system",
            content:
              "You are the OpenContext Law Enforcer Watchman. Judge only workflow-law compliance and respond in strict JSON schema.",
          },
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
        maxTokens: law.critic.maxTokensWatchman || 320,
        schemaName: "opencontext_watchman",
        schema: WATCHMAN_RESPONSE_SCHEMA,
      }),
    });
    if (!result.ok) {
      return {
        available: false,
        violation: false,
        source: "http_error",
        status: result.status,
        error: result.raw,
        apiKeyEnv: sourceEnv,
        model,
      };
    }
    const parsed = result.parsed;
    if (!parsed) {
      return {
        available: false,
        violation: false,
        source: "parse_invalid_json",
        apiKeyEnv: sourceEnv,
        model,
        raw: result.raw,
      };
    }
    if (typeof parsed.violation !== "boolean") {
      return {
        available: false,
        violation: false,
        source: "parse_invalid_shape",
        apiKeyEnv: sourceEnv,
        model,
        raw: clipText(safeJsonString(parsed), 500),
      };
    }
    const violation = parsed?.violation === true;
    const rule = clipText(parsed?.rule || "watchman_policy_violation", 120);
    const reason = clipText(parsed?.reason || "Policy violation detected by watchman model.", 400);
    const correctionPrompt = clipText(parsed?.correction_prompt || "", 2500);
    const confidence = Number(parsed?.confidence ?? 0);
    return {
      available: true,
      violation,
      source: "watchman_model",
      rule,
      reason,
      correctionPrompt,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      model,
      apiKeyEnv: sourceEnv,
    };
  } catch (error) {
    return {
      available: false,
      violation: false,
      source: "watchman_error",
      error: error?.message ?? String(error),
      apiKeyEnv: sourceEnv,
      model,
    };
  }
}

async function maybeInterrupt(client, directory, law, state, violation) {
  const now = Date.now();
  const minGap = law.cooldowns.interruptionSeconds * 1000;
  const sameRuleGap = law.cooldowns.sameRuleSeconds * 1000;
  const lastForRule = state.lastRuleInjectionAt[violation.rule] || 0;

  if (now - state.lastInjectionAt < minGap) return false;
  if (now - lastForRule < sameRuleGap) return false;
  if (state.consecutiveInjections >= law.limits.maxConsecutiveInjections) return false;

  let enforce = true;
  if (violation.useCritic) {
    const verdict = await runCriticCheck(client, law, {
      rule: violation.rule,
      detail: violation.detail,
      recentTools: state.recentTools.slice(-5),
    });
    enforce = verdict.enforce;
    await log(client, "info", "law.critic.verdict", {
      rule: violation.rule,
      enforce,
      source: verdict.source,
      reason: verdict.reason || "",
    });
  }
  if (!enforce) return false;

  const prompt = violation.promptText || buildViolationPrompt(violation);
  await appendLawTrace(client, directory, law, {
    type: "law.interrupt.request",
    sessionId: state.sessionId,
    violation: {
      rule: violation.rule,
      detail: violation.detail,
      source: violation.source || "deterministic",
    },
    prompt: clipText(prompt, 4000),
  });
  const injected = await injectContinuation(client, directory, state, prompt);
  if (injected) {
    state.lastInjectionAt = now;
    state.lastRuleInjectionAt[violation.rule] = now;
    state.consecutiveInjections += 1;
    state.hasViolationDebt = true;
    await log(client, "warn", "law.interrupt.injected", {
      sessionId: state.sessionId,
      rule: violation.rule,
      detail: violation.detail,
      source: violation.source || "deterministic",
    });
    await appendLawTrace(client, directory, law, {
      type: "law.interrupt.injected",
      sessionId: state.sessionId,
      violation: {
        rule: violation.rule,
        detail: violation.detail,
        source: violation.source || "deterministic",
      },
    });
  }
  await toast(client, {
    type: "warning",
    timeout: 9000,
    message: `⚖️ Law Enforcer: ${violation.rule}\n${violation.detail}`,
  });
  return injected;
}

function buildViolations({ directory, law, state, tool, commandText, toolOutput, hasGCC, planningAgentActive }) {
  const violations = [];
  const checkpointEvery = law.gcc.requireCheckpointEveryTools;

  if (law.gcc.requireInit && !hasGCC) {
    violations.push({
      rule: "gcc_init_required",
      detail: "GCC is not initialized in this project directory.",
      commands: ['opencontext init --project-name "<name>" --goal "<goal>"'],
      useCritic: false,
    });
    return violations;
  }

  if (law.gcc.compactionCheckpointRequired && state.pendingCompactionCheckpoint) {
    violations.push({
      rule: "compaction_checkpoint_required",
      detail: "Session compaction occurred and checkpoint debt is still open.",
      commands: [
        'opencontext commit "Post-compaction checkpoint"',
        'opencontext context --log --lines 80',
      ],
      useCritic: false,
    });
  }

  if (
    state.sinceCommitCount >= checkpointEvery &&
    isGCCInitialized(directory) &&
    !(planningAgentActive && law.gcc.skipCheckpointDuringPlanningAgent)
  ) {
    violations.push({
      rule: "checkpoint_overdue",
      detail: `More than ${checkpointEvery} significant tool calls occurred without a GCC checkpoint.`,
      commands: ['opencontext commit "Checkpoint after significant progress"'],
      useCritic: false,
    });
  }

  if (
    law.gcc.requireFailedAttemptLookup &&
    state.pendingFailureLookup &&
    !isOpenContextContextLookup(commandText)
  ) {
    const toolLower = toLowerSafe(tool);
    if (toolLower.includes("edit") || toolLower.includes("write") || toolLower.includes("bash")) {
      violations.push({
        rule: "failed_attempt_lookup_required",
        detail: "A failure was detected. Retrieve previous attempts before retrying.",
        commands: ['opencontext context --search "<feature or failure>"', "opencontext context --log --lines 80"],
        useCritic: true,
      });
    }
  }

  if (
    law.research.requireCaptureOnDocsOrGithub &&
    state.pendingResearchCapture &&
    !isOpenContextCommitCommand(commandText)
  ) {
    violations.push({
      rule: "research_capture_required",
      detail: "Documentation/GitHub research was detected but not checkpointed.",
      commands: ['opencontext commit "Research findings on <topic>"'],
      useCritic: false,
    });
  }

  if (law.mcp.requireUseWhenRelevant && !state.mcpUsed) {
    const interval = law.mcp.usageReminderEveryTools;
    const t = toLowerSafe(tool);
    const researchLike = t.includes("search") || t.includes("webfetch") || state.pendingResearchCapture;
    if (researchLike && state.toolExecutionCount % interval === 0) {
      violations.push({
        rule: "mcp_usage_expected",
        detail: "Task pattern suggests MCP tools could help, but none were used recently.",
        commands: ["Review available MCPs and use a relevant MCP tool before continuing."],
        useCritic: true,
      });
    }
  }

  return violations;
}

async function evaluateAndEnforce({
  client,
  directory,
  law,
  state,
  trigger,
  tool,
  commandText,
  toolOutput,
  hasGCC,
  assistantMessageId,
}) {
  let violationDetected = false;
  const violations = buildViolations({
    directory,
    law,
    state,
    tool: tool || "unknown",
    commandText: commandText || "",
    toolOutput: toolOutput || "",
    hasGCC,
    planningAgentActive: isPlanningAgentName(state?.lastAgent),
  });

  if (violations.length > 0) {
    violationDetected = true;
    await log(client, "warn", "law.violation.detected", {
      sessionId: state.sessionId,
      rule: violations[0].rule,
      trigger,
    });
    const injected = await maybeInterrupt(client, directory, law, state, violations[0]);
    if (injected) return true;
  }

  const shouldRunWatchman =
    law.watchman.enabled &&
    ((trigger === "assistant_turn" && law.watchman.inspectAssistantTurns) ||
      (trigger === "tool_call" && law.watchman.inspectToolCalls) ||
      (trigger === "compaction" && law.watchman.inspectCompaction) ||
      (trigger === "idle" && law.watchman.inspectOnIdle)) &&
    !(law.watchman.skipDuringPlanningAgent && isPlanningAgentName(state?.lastAgent));

  if (!shouldRunWatchman || state.inspectorInFlight) {
    if (!violationDetected) {
      state.consecutiveInjections = 0;
    }
    return false;
  }

  state.inspectorInFlight = true;
  try {
    const evidence = await collectWatchmanEvidence(client, law, state);
    const latestAssistant = evidence.latestAssistant;
    if (!latestAssistant) return false;

    if (assistantMessageId && latestAssistant.id && assistantMessageId !== latestAssistant.id) {
      return false;
    }
    if (
      trigger !== "tool_call" &&
      latestAssistant.id &&
      latestAssistant.id === state.lastInspectedAssistantMessageId
    ) {
      return false;
    }

    const watchmanPayload = {
      trigger,
      law: buildLawSummaryForInspector(law),
      latestAssistant,
      recentMessages: evidence.recentMessages,
      recentToolCalls: evidence.recentToolCalls,
      debts: evidence.debts,
    };
    await appendLawTrace(client, directory, law, {
      type: "watchman.request",
      sessionId: state.sessionId,
      trigger,
      model: resolveCriticModel(law),
      evidence: {
        latestAssistant,
        recentMessages: evidence.recentMessages,
        recentToolCalls: evidence.recentToolCalls,
        debts: evidence.debts,
      },
    });

    const verdict = await runWatchmanCheck(client, law, watchmanPayload);
    await appendLawTrace(client, directory, law, {
      type: "watchman.response",
      sessionId: state.sessionId,
      trigger,
      verdict,
    });

    await log(client, "info", "law.watchman.verdict", {
      trigger,
      sessionId: state.sessionId,
      available: verdict.available,
      violation: verdict.violation,
      source: verdict.source,
      rule: verdict.rule || "",
      confidence: verdict.confidence ?? 0,
      model: verdict.model || resolveCriticModel(law),
      apiKeyEnv: verdict.apiKeyEnv || "",
      status: verdict.status || 0,
      error: verdict.error || "",
      raw: verdict.raw || "",
    });

    if (!verdict.available || !verdict.violation) {
      if (latestAssistant.id) {
        state.lastInspectedAssistantMessageId = latestAssistant.id;
      }
      if (!violationDetected) {
        state.consecutiveInjections = 0;
      }
      return false;
    }

    const fallbackPrompt = buildViolationPrompt({
      rule: verdict.rule || "watchman_policy_violation",
      detail: verdict.reason || "Law Enforcer requested a workflow correction.",
      commands: ["Comply with OpenContext law requirements before continuing."],
    });
    const correctionPrompt = verdict.correctionPrompt || fallbackPrompt;

    const injected = await maybeInterrupt(client, directory, law, state, {
      rule: verdict.rule || "watchman_policy_violation",
      detail: verdict.reason || "Law Enforcer detected a policy violation.",
      commands: [],
      useCritic: false,
      promptText: correctionPrompt,
      source: "watchman_model",
    });

    if (latestAssistant.id) {
      state.lastInspectedAssistantMessageId = latestAssistant.id;
    }
    return injected;
  } finally {
    state.inspectorInFlight = false;
  }
}

export const OpenContextPlugin = async ({ client, directory }) => {
  await log(client, "info", "plugin initialized", { directory });

  return {
    event: async ({ event }) => {
      const law = await loadLaw(client, directory);
      const sessionId = extractSessionIdFromEvent(event);
      if (sessionId) {
        activeSessionId = sessionId;
      }
      const state = getSessionState(sessionId || activeSessionId);

      if (event.type === "session.created") {
        await log(client, "debug", "event session.created");
        if (state) {
          state.consecutiveInjections = 0;
        }
        const hasGCC = isGCCInitialized(directory);
        if (!hasGCC) {
          await log(client, "debug", "gcc not initialized", { directory });
          await toast(client, {
            message:
              '📦 OpenContext available but not initialized in this directory.\nRun: opencontext init --project-name "<name>" --goal "<goal>"',
            type: "info",
            timeout: 10000,
          });
        } else {
          const gccInfo = await getCachedGCCContext(directory, client);
          if (gccInfo) {
            const branch = parseBranchFromStatus(gccInfo.status);
            const lastCommit = parseLastCommitFromStatus(gccInfo.status);
            await toast(client, {
              message: `📦 GCC Context Loaded\nBranch: ${branch}\nLast: ${lastCommit.substring(0, 40)}...`,
              type: "info",
              timeout: 8000,
            });
            await log(client, "info", "gcc context loaded", {
              branch,
              hasCommit: lastCommit !== "none",
            });
          }
        }

        if (law.mcp.requireAwarenessAtSessionStart) {
          const mcpNames = await getAvailableMcpNames();
          const summary = mcpNames.length > 0 ? mcpNames.join(", ") : "none discovered";
          await toast(client, {
            type: "info",
            timeout: 9000,
            message: `🧰 MCP awareness check\nAvailable MCPs: ${summary}\nUse MCPs when relevant before defaulting to generic tools.`,
          });
        }
      }

      if (event.type === "session.compacted") {
        await log(client, "debug", "event session.compacted");
        if (state) {
          state.pendingCompactionCheckpoint = true;
          state.hasViolationDebt = true;
        }
        if (!isGCCInitialized(directory)) {
          await toast(client, {
            message:
              "⚠️ Context compacted.\nInitialize OpenContext first:\nopencontext init --project-name \"<name>\" --goal \"<goal>\"",
            type: "warning",
            timeout: 10000,
          });
          return;
        }
        await toast(client, {
          message:
            "⚠️ Context compacted.\nCheckpoint now: opencontext commit \"<summary>\"\nThen recover details with: opencontext context --log --lines 80",
          type: "warning",
          timeout: 10000,
        });

        if (state) {
          await evaluateAndEnforce({
            client,
            directory,
            law,
            state,
            trigger: "compaction",
            tool: "session.compacted",
            commandText: "",
            toolOutput: "",
            hasGCC: isGCCInitialized(directory),
          });
        }
      }

      if (event.type === "message.updated") {
        const info = event?.properties?.info || {};
        const infoSessionId = info.sessionID || sessionId;
        const infoState = getSessionState(infoSessionId || activeSessionId);
        if (infoState) {
          if (typeof info.agent === "string") infoState.lastAgent = info.agent;
          if (info.model && typeof info.model === "object") {
            infoState.lastModel = info.model;
          } else if (info.providerID && info.modelID) {
            infoState.lastModel = {
              providerID: info.providerID,
              modelID: info.modelID,
            };
          }
        }

        if (isGCCInitialized(directory)) {
          messageUpdateCount += 1;
          const contextPercent = Math.min(100, Math.round((messageUpdateCount / 50) * 100));
          if (
            contextPercent >= CONFIG.contextWarningThreshold &&
            contextPercent % 10 === 0 &&
            contextPercent !== lastContextWarningPercent
          ) {
            lastContextWarningPercent = contextPercent;
            await log(client, "info", "high context usage", {
              contextPercent,
              messageUpdateCount,
            });
            await toast(client, {
              message: `📊 Context usage: ${contextPercent}%\nConsider: opencontext commit "<summary>"`,
              type: "info",
              timeout: 8000,
            });
          }
        }

        if (infoState && hasAssistantCompletion(info)) {
          await evaluateAndEnforce({
            client,
            directory,
            law,
            state: infoState,
            trigger: "assistant_turn",
            tool: "assistant.message",
            commandText: "",
            toolOutput: "",
            hasGCC: isGCCInitialized(directory),
            assistantMessageId: info.id || "",
          });
        }
      }

      if (event.type === "session.idle" && state) {
        await log(client, "debug", "event session.idle", { toolExecutionCount: state.toolExecutionCount });
        const hasGCC = isGCCInitialized(directory);
        const interrupted = await evaluateAndEnforce({
          client,
          directory,
          law,
          state,
          trigger: "idle",
          tool: "idle",
          commandText: "",
          toolOutput: "",
          hasGCC,
        });

        if (!interrupted && hasGCC && state.toolExecutionCount > 2) {
          await toast(client, {
            message: `⏸️ Session idle after ${state.toolExecutionCount} actions.\nConsider: opencontext commit "Session checkpoint"`,
            type: "info",
            timeout: 8000,
          });
        }
      }
    },

    "experimental.session.compacting": async (_input, output = {}) => {
      const law = await loadLaw(client, directory);
      await log(client, "debug", "hook experimental.session.compacting");
      const hasGCC = isGCCInitialized(directory);

      const reminder = hasGCC
        ? `OpenContext Law Enforcer: context is being compacted. Required: \`opencontext commit "<summary>"\`, then \`opencontext context --log --lines 80\`. Mode=${law.mode}.`
        : 'OpenContext Law Enforcer: GCC is not initialized. Run `opencontext init --project-name "<name>" --goal "<goal>"` before continuing long tasks.';
      output.context = Array.isArray(output.context) ? output.context : [];
      output.context.push(reminder);
      return output;
    },

    "experimental.chat.system.transform": async (_input, output = {}) => {
      const law = await loadLaw(client, directory);
      const hasGCC = isGCCInitialized(directory);
      output.system = Array.isArray(output.system) ? output.system : [];
      output.system.push(
        `OpenContext Law Contract:
- Mode: ${law.mode}
- Keep long-horizon context externalized via OpenContext.
- After significant tool calls (edit/test/research), checkpoint with opencontext commit.
- Before retrying failed implementations, retrieve previous attempts via opencontext context --search/--log.
- Use relevant MCP tools when they can improve retrieval, docs grounding, or execution quality.`
      );

      if (!hasGCC) {
        await log(client, "debug", "system prompt augmented (no gcc)");
      } else {
        const gccInfo = await getCachedGCCContext(directory, client);
        if (gccInfo) {
          const branch = parseBranchFromStatus(gccInfo.status);
          const lastCommit = parseLastCommitFromStatus(gccInfo.status);
          output.system.push(
            `OpenContext (GCC) Active:
- Current Branch: ${branch}
- Last Commit: ${lastCommit}
- Checkpoint cadence: every ${law.gcc.requireCheckpointEveryTools} significant tool calls.
- Compaction requires immediate checkpoint + context recovery.
- Record research findings and failed attempts as first-class context artifacts.`
          );
          await log(client, "debug", "system prompt augmented", { branch });
        }
      }

      const assertToken = process.env.OPENCONTEXT_ASSERT_TOKEN?.trim();
      if (assertToken) {
        output.system.push(
          `OpenContext verification mode: start your next assistant response with EXACTLY "${assertToken}" then continue normally.`
        );
        await log(client, "info", "assert token mode enabled", {
          assertToken,
        });
      }
      return output;
    },

    "tool.execute.after": async (input = {}, output = {}) => {
      const law = await loadLaw(client, directory);
      const tool = toToolName(input.tool);
      const args = input.args ?? {};
      const toolOutput = output?.output ?? "";
      const commandText = extractCommandFromArgs(args);
      const sessionId = input.sessionID || activeSessionId || "";
      const state = getSessionState(sessionId || activeSessionId);
      const hasGCC = isGCCInitialized(directory);

      if (!state) return;
      if (!activeSessionId && sessionId) activeSessionId = sessionId;
      if (typeof input.agent === "string" && input.agent.trim()) {
        state.lastAgent = input.agent.trim();
      }

      appendRecentTool(state, tool);
      appendRecentToolExecution(state, {
        time: new Date().toISOString(),
        tool,
        commandText: clipText(commandText),
        args: clipText(safeJsonString(args)),
        output: clipText(safeJsonString(toolOutput)),
      });
      await appendLawTrace(client, directory, law, {
        type: "tool.execute.after",
        sessionId: state.sessionId,
        tool: {
          name: tool,
          commandText: clipText(commandText),
          args: clipText(safeJsonString(args)),
          output: clipText(safeJsonString(toolOutput)),
        },
      });
      state.toolExecutionCount += 1;
      if (shouldIncrementCheckpointDebt({ law, state, tool, commandText })) {
        state.sinceCommitCount += 1;
      }

      await log(client, "debug", "hook tool.execute.after", {
        tool,
        toolExecutionCount: state.toolExecutionCount,
        sinceCommitCount: state.sinceCommitCount,
        hasGCC,
      });

      if (isMcpTool(tool)) {
        state.mcpUsed = true;
      }

      if (isOpenContextCommitCommand(commandText)) {
        state.sinceCommitCount = 0;
        state.pendingCompactionCheckpoint = false;
        state.pendingResearchCapture = false;
        state.hasViolationDebt = false;
        state.consecutiveInjections = 0;
      }
      if (isOpenContextContextLookup(commandText)) {
        state.pendingFailureLookup = false;
      }
      if (isOpenContextInitCommand(commandText) && isGCCInitialized(directory)) {
        state.hasViolationDebt = false;
      }

      const researchSignal = detectResearchSignal(tool, args, toolOutput, law);
      if (researchSignal) {
        await log(client, "info", "research source detected", {
          tool,
          sourceType: researchSignal.sourceType,
          urls: researchSignal.urls,
        });
        if (law.research.requireCaptureOnDocsOrGithub) {
          state.pendingResearchCapture = true;
          const now = Date.now();
          if (now - state.lastResearchReminderTime >= CONFIG.researchReminderCooldownMs) {
            state.lastResearchReminderTime = now;
            const firstUrl = researchSignal.urls[0] || "";
            await toast(client, {
              message: `🔎 Research signal (${researchSignal.sourceType}) detected${firstUrl ? `: ${firstUrl}` : ""}\nCapture with:\nopencontext commit "Research findings on <topic>"`,
              type: "info",
              timeout: 10000,
            });
          }
        }
      }

      if (law.gcc.requireFailedAttemptLookup && detectFailureSignal(tool, toolOutput)) {
        state.pendingFailureLookup = true;
        state.hasViolationDebt = true;
      }

      const interrupted = await evaluateAndEnforce({
        client,
        directory,
        law,
        state,
        trigger: "tool_call",
        tool,
        commandText,
        toolOutput,
        hasGCC,
      });

      if (!interrupted && state.toolExecutionCount % law.gcc.requireCheckpointEveryTools === 0) {
        if (hasGCC) {
          await toast(client, {
            message: `🎯 ${state.toolExecutionCount} actions completed.\nCheckpoint now:\nopencontext commit "Checkpoint progress"`,
            type: "info",
            timeout: 8000,
          });
        }
      }
    },
  };
};

export default OpenContextPlugin;
