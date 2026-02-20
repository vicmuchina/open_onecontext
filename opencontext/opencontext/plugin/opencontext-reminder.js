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
  lawPolicyFileName: "law-policy.txt",
  watchmanSystemPromptFileName: "law-watchman-system.txt",
  failurePolicyFileName: "law-failure-policy.txt",
  researchPolicyFileName: "law-research-policy.txt",
  agentGuideFileName: "AGENT_GUIDE.txt",
  runtimeConfigFileName: "law-runtime.json",
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
    requireCheckpointEveryTools: 10,
    checkpointDebtJudgeMode: "model_only",
    requireFailedAttemptLookup: true,
    failureLookupPolicyFile: "law-failure-policy.txt",
    failureClassifierEnabled: true,
    failureClassifierMinConfidence: 0.7,
    failureClassifierRequireModelDecision: true,
    compactionCheckpointRequired: true,
    compactionDebtJudgeMode: "model_only",
    skipCheckpointDuringPlanningAgent: true,
    countReadOnlyToolsForCheckpoint: false,
  },
  mcp: {
    requireAwarenessAtSessionStart: true,
    requireUseWhenRelevant: true,
    usageReminderEveryTools: 8,
  },
  research: {
    requireCaptureOnDocsOrGithub: true,
    capturePolicyFile: "law-research-policy.txt",
    captureClassifierEnabled: true,
    captureClassifierMinConfidence: 0.7,
    captureClassifierRequireModelDecision: true,
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
    model: "chutesai/Mistral-Small-3.2-24B-Instruct-2506",
    modelFallbacks: [
      "NousResearch/Hermes-4-14B",
      "zai-org/GLM-4.6-FP8",
      "deepseek-ai/DeepSeek-V3-0324-TEE",
    ],
    apiKeyEnv: "CHUTES_API_KEY",
    modelEnv: "OPENCONTEXT_LAW_MODEL_ID",
    timeoutMs: 8000,
    maxTokensCritic: 120,
    maxTokensWatchman: 320,
    strictJsonRetryAttempts: 2,
    responseFormatStrategy: "json_schema_then_json_object",
  },
  watchman: {
    enabled: true,
    inspectAssistantTurns: true,
    inspectToolCalls: false,
    inspectCompaction: true,
    inspectOnIdle: false,
    skipDuringPlanningAgent: true,
    dedupeSameViolationUntilResolved: true,
    minConfidence: 0.75,
    requireModelDecision: true,
    systemPromptFile: "law-watchman-system.txt",
    includeRecentMessages: 12,
    includeRecentToolCalls: 12,
    includeRecentAlerts: 12,
    includeRecentActionsAfterAlerts: 20,
  },
  observability: {
    traceEnabled: true,
    traceFile: "law-enforcer-trace.jsonl",
  },
  custom: {
    enabled: true,
    policyFile: "law-policy.txt",
    exemptAgentPatterns: ["plan", "planner"],
    escalation: {
      mode: "soft_then_hard",
      softViolationsBeforeInterrupt: 2,
      hardInterruptThreshold: 3,
      reminderCooldownSeconds: 60,
      resetOnCommit: true,
    },
    rules: [],
    hints: {
      availableTools: [],
      availableSkills: [],
      preferredCommands: [],
      importantMcpServers: [],
    },
  },
  agentGuide: {
    path: ".GCC/AGENT_GUIDE.txt",
    includeInWatchmanPayload: true,
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
let runtimeConfigCache = {
  fetchedAt: 0,
  directory: "",
  data: null,
};
let mcpNamesCache = {
  fetchedAt: 0,
  data: [],
};
let cliCapabilitiesCache = {
  fetchedAt: 0,
  directory: "",
  data: null,
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
    satisfaction_evidence: { type: "string" },
    debt_updates: {
      type: "object",
      additionalProperties: false,
      properties: {
        pendingCompactionCheckpoint: {
          type: "string",
          enum: ["open", "clear", "keep"],
        },
        pendingCheckpointOverdue: {
          type: "string",
          enum: ["open", "clear", "keep"],
        },
      },
    },
  },
};

const FAILURE_LOOKUP_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["require_lookup", "reason", "confidence"],
  properties: {
    require_lookup: { type: "boolean" },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
};

const RESEARCH_CAPTURE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["require_capture", "reason", "confidence"],
  properties: {
    require_capture: { type: "boolean" },
    reason: { type: "string" },
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
      pendingCheckpointOverdue: false,
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
      customRuleViolations: {},
      customRuleReminderAt: {},
      ruleDebtOpen: {},
      recentInterruptions: [],
      recentDebtTransitions: [],
      lastCompactionAt: 0,
      lastCommitAt: 0,
      lastContextRecoveryAt: 0,
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

function appendBounded(list, item, limit = 20) {
  if (!Array.isArray(list)) return;
  list.push(item);
  while (list.length > Math.max(1, Number(limit || 1))) {
    list.shift();
  }
}

function toEpochMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
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

function readUtf8Safe(path) {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function readTailLinesSafe(path, maxLines = 120, maxChars = 4000) {
  const raw = readUtf8Safe(path);
  if (!raw) return "";
  const lines = raw.split("\n");
  const tail = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  return clipText(tail, maxChars);
}

function tokenizeSemantic(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9_\- ]+/g, " ")
        .split(/\s+/)
        .filter((part) => part.length >= 4)
    )
  );
}

function scoreSemanticOverlap(queryTokens, candidateText) {
  if (!Array.isArray(queryTokens) || queryTokens.length === 0) return 0;
  const corpus = ` ${toLowerSafe(candidateText)} `;
  let hits = 0;
  for (const token of queryTokens) {
    if (token && corpus.includes(` ${token} `)) hits += 1;
  }
  return hits / queryTokens.length;
}

function findSemanticHistoryMatches(queryText, blocks, limit = 5) {
  const queryTokens = tokenizeSemantic(queryText).slice(0, 28);
  if (queryTokens.length === 0) return [];
  const rows = [];
  for (const block of blocks) {
    const text = String(block?.text || "");
    if (!text) continue;
    const pieces = text
      .split(/\n{2,}/)
      .map((piece) => piece.trim())
      .filter(Boolean)
      .slice(-80);
    for (const piece of pieces) {
      const score = scoreSemanticOverlap(queryTokens, piece);
      if (score < 0.14) continue;
      rows.push({
        source: block.source,
        score,
        snippet: clipText(piece, 450),
      });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.source}::${row.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function collectGccHistoryEvidence(directory, queryText = "") {
  const gccDir = join(directory, CONFIG.gccDir);
  if (!existsSync(gccDir)) {
    return {
      available: false,
      reason: "gcc_not_initialized",
      currentBranch: "",
      files: {},
      semanticMatches: [],
    };
  }

  const currentBranchRaw = readUtf8Safe(join(gccDir, ".current_branch")).trim();
  const currentBranch = currentBranchRaw || "main";
  const branchDir = join(gccDir, "branches", currentBranch);
  const files = {
    main: readTailLinesSafe(join(gccDir, "main.md"), 120, 5000),
    commit: readTailLinesSafe(join(branchDir, "commit.md"), 220, 9000),
    log: readTailLinesSafe(join(branchDir, "log.md"), 220, 9000),
    metadata: readTailLinesSafe(join(branchDir, "metadata.yaml"), 120, 4500),
  };
  const blocks = [
    { source: `${CONFIG.gccDir}/main.md`, text: files.main },
    { source: `${CONFIG.gccDir}/branches/${currentBranch}/commit.md`, text: files.commit },
    { source: `${CONFIG.gccDir}/branches/${currentBranch}/log.md`, text: files.log },
    { source: `${CONFIG.gccDir}/branches/${currentBranch}/metadata.yaml`, text: files.metadata },
  ];
  const semanticMatches = findSemanticHistoryMatches(queryText, blocks, 5);
  return {
    available: true,
    currentBranch,
    files,
    semanticMatches,
  };
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

function normalizeStringArray(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizeRuleTrigger(trigger) {
  const value = String(trigger || "").trim().toLowerCase();
  if (!value) return "";
  if (["assistant_turn", "assistant", "message"].includes(value)) return "assistant_turn";
  if (["tool_call", "tool", "tool.execute.after"].includes(value)) return "tool_call";
  if (["compaction", "session.compacted"].includes(value)) return "compaction";
  if (["idle", "session.idle"].includes(value)) return "idle";
  return value;
}

function normalizeCustomRule(rawRule, index = 0) {
  const rule = rawRule && typeof rawRule === "object" ? rawRule : {};
  const idFallback = `custom_rule_${index + 1}`;
  const id = String(rule.id || rule.name || idFallback).trim() || idFallback;
  const triggersRaw = normalizeStringArray(rule.triggers, []);
  const triggers = triggersRaw
    .map(normalizeRuleTrigger)
    .filter((value) => ["assistant_turn", "tool_call", "compaction", "idle"].includes(value));
  const when = rule.when && typeof rule.when === "object" ? rule.when : {};
  const requireShape = rule.require && typeof rule.require === "object" ? rule.require : {};
  const interruptAfter = Number(rule.interruptAfterViolations);
  return {
    id,
    enabled: rule.enabled !== false,
    description: String(rule.description || "").trim(),
    severity: String(rule.severity || "medium").trim().toLowerCase(),
    triggers,
    when: {
      taskKeywords: normalizeStringArray(when.taskKeywords, []),
      toolIncludes: normalizeStringArray(when.toolIncludes, []),
      toolExcludes: normalizeStringArray(when.toolExcludes, []),
      commandIncludes: normalizeStringArray(when.commandIncludes, []),
      commandRegex: normalizeStringArray(when.commandRegex, []),
      assistantIncludes: normalizeStringArray(when.assistantIncludes, []),
      outputIncludes: normalizeStringArray(when.outputIncludes, []),
      debtFlags: normalizeStringArray(when.debtFlags, []),
    },
    require: {
      anyTools: normalizeStringArray(requireShape.anyTools, []),
      anyCommands: normalizeStringArray(requireShape.anyCommands, []),
      guidance: String(requireShape.guidance || "").trim(),
    },
    interruptAfterViolations: Number.isFinite(interruptAfter)
      ? Math.max(1, Math.min(20, Math.round(interruptAfter)))
      : null,
  };
}

function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeDebtJudgeMode(value, fallback = "model_only") {
  const mode = String(value || fallback).trim().toLowerCase();
  if (["model_only", "model_first_fallback", "deterministic"].includes(mode)) {
    return mode;
  }
  return fallback;
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
  sanitized.gcc.checkpointDebtJudgeMode = normalizeDebtJudgeMode(
    sanitized.gcc.checkpointDebtJudgeMode,
    DEFAULT_LAW.gcc.checkpointDebtJudgeMode
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
  sanitized.gcc.failureLookupPolicyFile =
    typeof sanitized.gcc.failureLookupPolicyFile === "string" &&
    sanitized.gcc.failureLookupPolicyFile.trim()
      ? sanitized.gcc.failureLookupPolicyFile.trim()
      : CONFIG.failurePolicyFileName;
  sanitized.gcc.failureClassifierEnabled =
    sanitized.gcc.failureClassifierEnabled !== false;
  sanitized.gcc.failureClassifierMinConfidence = Math.max(
    0,
    Math.min(
      1,
      Number(
        sanitized.gcc.failureClassifierMinConfidence
          ?? DEFAULT_LAW.gcc.failureClassifierMinConfidence
      )
    )
  );
  sanitized.gcc.failureClassifierRequireModelDecision =
    sanitized.gcc.failureClassifierRequireModelDecision !== false;
  sanitized.gcc.compactionDebtJudgeMode = normalizeDebtJudgeMode(
    sanitized.gcc.compactionDebtJudgeMode,
    DEFAULT_LAW.gcc.compactionDebtJudgeMode
  );
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
  sanitized.critic.strictJsonRetryAttempts = Math.max(
    0,
    Math.min(
      5,
      Math.round(
        Number(sanitized.critic.strictJsonRetryAttempts ?? DEFAULT_LAW.critic.strictJsonRetryAttempts)
      )
    )
  );
  if (!sanitized.critic.apiKeyEnv || typeof sanitized.critic.apiKeyEnv !== "string") {
    sanitized.critic.apiKeyEnv = "CHUTES_API_KEY";
  }
  if (!sanitized.critic.model || typeof sanitized.critic.model !== "string") {
    sanitized.critic.model = DEFAULT_LAW.critic.model;
  }
  sanitized.critic.model = sanitized.critic.model.trim() || DEFAULT_LAW.critic.model;
  const fallbackModels = normalizeStringArray(
    sanitized.critic.modelFallbacks,
    DEFAULT_LAW.critic.modelFallbacks
  );
  const seenModels = new Set([sanitized.critic.model]);
  sanitized.critic.modelFallbacks = [];
  for (const candidate of fallbackModels) {
    const value = String(candidate || "").trim();
    if (!value || seenModels.has(value)) continue;
    seenModels.add(value);
    sanitized.critic.modelFallbacks.push(value);
  }
  const allowedResponseFormats = new Set([
    "json_schema",
    "json_object",
    "json_schema_then_json_object",
  ]);
  const strategy = String(
    sanitized.critic.responseFormatStrategy || DEFAULT_LAW.critic.responseFormatStrategy
  ).trim().toLowerCase();
  sanitized.critic.responseFormatStrategy = allowedResponseFormats.has(strategy)
    ? strategy
    : DEFAULT_LAW.critic.responseFormatStrategy;
  sanitized.watchman.enabled = sanitized.watchman.enabled !== false;
  sanitized.watchman.inspectAssistantTurns = sanitized.watchman.inspectAssistantTurns !== false;
  sanitized.watchman.inspectToolCalls = sanitized.watchman.inspectToolCalls !== false;
  sanitized.watchman.inspectCompaction = sanitized.watchman.inspectCompaction !== false;
  sanitized.watchman.inspectOnIdle = sanitized.watchman.inspectOnIdle !== false;
  sanitized.watchman.skipDuringPlanningAgent = sanitized.watchman.skipDuringPlanningAgent !== false;
  sanitized.watchman.dedupeSameViolationUntilResolved =
    sanitized.watchman.dedupeSameViolationUntilResolved !== false;
  sanitized.watchman.minConfidence = Math.max(
    0,
    Math.min(1, Number(sanitized.watchman.minConfidence ?? DEFAULT_LAW.watchman.minConfidence))
  );
  sanitized.watchman.requireModelDecision =
    sanitized.watchman.requireModelDecision !== false;
  sanitized.watchman.systemPromptFile =
    typeof sanitized.watchman.systemPromptFile === "string" &&
    sanitized.watchman.systemPromptFile.trim()
      ? sanitized.watchman.systemPromptFile.trim()
      : CONFIG.watchmanSystemPromptFileName;
  sanitized.watchman.includeRecentMessages = Math.max(
    2,
    Math.min(50, Number(sanitized.watchman.includeRecentMessages || 12))
  );
  sanitized.watchman.includeRecentToolCalls = Math.max(
    2,
    Math.min(50, Number(sanitized.watchman.includeRecentToolCalls || 12))
  );
  sanitized.watchman.includeRecentAlerts = Math.max(
    2,
    Math.min(50, Number(sanitized.watchman.includeRecentAlerts || 12))
  );
  sanitized.watchman.includeRecentActionsAfterAlerts = Math.max(
    2,
    Math.min(80, Number(sanitized.watchman.includeRecentActionsAfterAlerts || 20))
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
  sanitized.research.capturePolicyFile =
    typeof sanitized.research.capturePolicyFile === "string" &&
    sanitized.research.capturePolicyFile.trim()
      ? sanitized.research.capturePolicyFile.trim()
      : CONFIG.researchPolicyFileName;
  sanitized.research.captureClassifierEnabled =
    sanitized.research.captureClassifierEnabled !== false;
  sanitized.research.captureClassifierMinConfidence = Math.max(
    0,
    Math.min(
      1,
      Number(
        sanitized.research.captureClassifierMinConfidence
          ?? DEFAULT_LAW.research.captureClassifierMinConfidence
      )
    )
  );
  sanitized.research.captureClassifierRequireModelDecision =
    sanitized.research.captureClassifierRequireModelDecision !== false;
  sanitized.custom = sanitized.custom && typeof sanitized.custom === "object"
    ? sanitized.custom
    : {};
  sanitized.custom.enabled = toBool(sanitized.custom.enabled, true);
  sanitized.custom.policyFile = typeof sanitized.custom.policyFile === "string" && sanitized.custom.policyFile.trim()
    ? sanitized.custom.policyFile.trim()
    : CONFIG.lawPolicyFileName;
  sanitized.custom.exemptAgentPatterns = normalizeStringArray(
    sanitized.custom.exemptAgentPatterns,
    DEFAULT_LAW.custom.exemptAgentPatterns
  );
  sanitized.custom.rules = Array.isArray(sanitized.custom.rules)
    ? sanitized.custom.rules.map((rule, index) => normalizeCustomRule(rule, index))
    : [];
  sanitized.custom.hints = sanitized.custom.hints && typeof sanitized.custom.hints === "object"
    ? sanitized.custom.hints
    : {};
  sanitized.custom.hints.availableTools = normalizeStringArray(
    sanitized.custom.hints.availableTools,
    []
  );
  sanitized.custom.hints.availableSkills = normalizeStringArray(
    sanitized.custom.hints.availableSkills,
    []
  );
  sanitized.custom.hints.preferredCommands = normalizeStringArray(
    sanitized.custom.hints.preferredCommands,
    []
  );
  sanitized.custom.hints.importantMcpServers = normalizeStringArray(
    sanitized.custom.hints.importantMcpServers,
    []
  );
  sanitized.custom.escalation = sanitized.custom.escalation && typeof sanitized.custom.escalation === "object"
    ? sanitized.custom.escalation
    : {};
  sanitized.custom.escalation.mode = String(
    sanitized.custom.escalation.mode || DEFAULT_LAW.custom.escalation.mode
  ).trim().toLowerCase();
  if (!["soft_then_hard", "hard_only", "soft_only"].includes(sanitized.custom.escalation.mode)) {
    sanitized.custom.escalation.mode = DEFAULT_LAW.custom.escalation.mode;
  }
  sanitized.custom.escalation.softViolationsBeforeInterrupt = Math.max(
    0,
    Math.min(
      20,
      Math.round(
        Number(
          sanitized.custom.escalation.softViolationsBeforeInterrupt
            ?? DEFAULT_LAW.custom.escalation.softViolationsBeforeInterrupt
        )
      )
    )
  );
  sanitized.custom.escalation.hardInterruptThreshold = Math.max(
    1,
    Math.min(
      30,
      Math.round(
        Number(
          sanitized.custom.escalation.hardInterruptThreshold
            ?? DEFAULT_LAW.custom.escalation.hardInterruptThreshold
        )
      )
    )
  );
  sanitized.custom.escalation.reminderCooldownSeconds = Math.max(
    0,
    Math.min(
      600,
      Math.round(
        Number(
          sanitized.custom.escalation.reminderCooldownSeconds
            ?? DEFAULT_LAW.custom.escalation.reminderCooldownSeconds
        )
      )
    )
  );
  sanitized.custom.escalation.resetOnCommit = toBool(
    sanitized.custom.escalation.resetOnCommit,
    true
  );
  sanitized.agentGuide = sanitized.agentGuide && typeof sanitized.agentGuide === "object"
    ? sanitized.agentGuide
    : {};
  sanitized.agentGuide.path = typeof sanitized.agentGuide.path === "string" && sanitized.agentGuide.path.trim()
    ? sanitized.agentGuide.path.trim()
    : DEFAULT_LAW.agentGuide.path;
  sanitized.agentGuide.includeInWatchmanPayload = toBool(
    sanitized.agentGuide.includeInWatchmanPayload,
    true
  );
  return sanitized;
}

function getLawPaths(directory) {
  return [
    join(directory, CONFIG.gccDir, CONFIG.lawFileNameJson),
    join(directory, CONFIG.gccDir, CONFIG.lawFileNameYaml),
  ];
}

function getRuntimeConfigPaths(directory) {
  return [
    join(homedir(), ".config", "opencontext", CONFIG.runtimeConfigFileName),
    join(directory, CONFIG.gccDir, CONFIG.runtimeConfigFileName),
  ];
}

function parseJsonFile(path) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeRuntimeCritic(runtimeRaw) {
  const fromRoot = runtimeRaw && typeof runtimeRaw === "object" ? runtimeRaw : {};
  const critic = fromRoot.critic && typeof fromRoot.critic === "object"
    ? fromRoot.critic
    : fromRoot;
  if (!critic || typeof critic !== "object") return {};

  const allowedKeys = [
    "apiKey",
    "model",
    "baseUrl",
    "endpointPath",
    "authHeader",
    "apiKeyPrefix",
    "headers",
    "request",
    "apiKeyEnv",
    "modelEnv",
    "modelFallbacks",
    "responseFormatStrategy",
    "timeoutMs",
    "maxTokensCritic",
    "maxTokensWatchman",
    "strictJsonRetryAttempts",
  ];
  const out = {};
  for (const key of allowedKeys) {
    const value = critic[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (
      key === "authHeader" &&
      typeof value === "string" &&
      value.trim().toLowerCase() === "authorization"
    ) {
      continue;
    }
    if (
      key === "apiKeyPrefix" &&
      typeof value === "string" &&
      value.trim() === "Bearer"
    ) {
      continue;
    }
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0 &&
      ["headers", "request"].includes(key)
    ) {
      continue;
    }
    if (key === "modelFallbacks") {
      if (!Array.isArray(value) || value.length === 0) continue;
      const normalized = value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      if (normalized.length === 0) continue;
      out[key] = normalized;
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function loadRuntimeCriticConfig(client, directory) {
  if (
    runtimeConfigCache.data &&
    runtimeConfigCache.directory === directory &&
    Date.now() - runtimeConfigCache.fetchedAt < CONFIG.lawCacheMs
  ) {
    return runtimeConfigCache.data;
  }

  const [globalPath, projectPath] = getRuntimeConfigPaths(directory);
  const merged = {};
  const sources = [];

  const globalParsed = sanitizeRuntimeCritic(parseJsonFile(globalPath));
  if (Object.keys(globalParsed).length > 0) {
    Object.assign(merged, globalParsed);
    sources.push("global");
  }

  const projectParsed = sanitizeRuntimeCritic(parseJsonFile(projectPath));
  if (Object.keys(projectParsed).length > 0) {
    Object.assign(merged, projectParsed);
    sources.push("project");
  }

  const result = {
    critic: merged,
    sources,
    paths: {
      global: globalPath,
      project: projectPath,
    },
  };
  runtimeConfigCache = {
    fetchedAt: Date.now(),
    directory,
    data: result,
  };
  await log(client, "debug", "law.runtime_config.loaded", {
    sources,
    paths: result.paths,
  });
  return result;
}

function defaultWatchmanSystemPrompt() {
  return [
    "You are the OpenContext Law Enforcer Watchman.",
    "Judge workflow-law compliance using provided law summary, policy text, agent guide, messages, tool calls, and debt flags.",
    "Return STRICT JSON only (no prose/markdown) matching schema fields exactly.",
    "You may return debt_updates to open/clear/keep checkpoint and compaction debt.",
    "Critical behavior:",
    "- Do not request duplicate interruption for the exact same unresolved violation without new evidence.",
    "- Use recentInterruptions and postAlertActions to verify whether prior alerts were already satisfied before alerting again.",
    "- For failed-attempt workflow, only flag violations for actionable implementation retries.",
    "- Treat pure environment/setup/CLI-usage noise as non-actionable unless policy explicitly says otherwise.",
    "- Interrupt only when there is a clear immediate corrective action the agent can perform.",
    "- Do not interrupt read-only discovery/exploration (listing files, reading docs, checking help/usage) unless policy explicitly marks it actionable.",
    "- Do not interrupt harmless command mistakes (wrong flag, missing optional tool, transient setup/network/dependency noise) unless repeated behavior clearly blocks implementation.",
    "- Interruption is expensive; if evidence is ambiguous, prefer violation=false and lower confidence.",
    "- For non-critical workflow issues, prefer persistent/repeated signals before interrupting.",
  ].join("\n");
}

function defaultFailureLookupPolicyPrompt() {
  return [
    "You classify whether OpenContext failure lookup is required before retry.",
    "Return STRICT JSON with fields: require_lookup (bool), reason (string), confidence (number).",
    "Set require_lookup=true ONLY for actionable implementation failures where retrying without prior-attempt lookup is risky.",
    "Set require_lookup=false for setup/env/package-manager/CLI usage noise unless it clearly reflects implementation logic failure.",
    "Examples of noise: missing option, command not found, missing file during exploration, dependency uninstall quirks.",
  ].join("\n");
}

function defaultResearchCapturePolicyPrompt() {
  return [
    "You classify whether recent activity should open OpenContext research-capture debt.",
    "Return STRICT JSON with fields: require_capture (bool), reason (string), confidence (number).",
    "Set require_capture=true when docs/specs/papers/GitHub/similar-project research produced implementation-relevant insight that should be checkpointed.",
    "Set require_capture=false when activity is routine/local exploration with no external research insight worth preserving.",
    "Use trajectory and history evidence: if this resembles a previously solved hurdle, lean true so the agent captures it.",
  ].join("\n");
}

async function loadOpenContextCliCapabilities(client, directory) {
  if (
    cliCapabilitiesCache.data &&
    cliCapabilitiesCache.directory === directory &&
    Date.now() - cliCapabilitiesCache.fetchedAt < CONFIG.lawCacheMs
  ) {
    return cliCapabilitiesCache.data;
  }

  const baseline = {
    available: false,
    contextSearch: false,
    contextLimit: false,
    contextLog: false,
  };
  try {
    const { execSync } = await import("child_process");
    const help = execSync("opencontext context --help", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
    });
    const caps = {
      available: true,
      contextSearch: help.includes("--search"),
      contextLimit: help.includes("--limit"),
      contextLog: help.includes("--log"),
    };
    cliCapabilitiesCache = {
      fetchedAt: Date.now(),
      directory,
      data: caps,
    };
    await log(client, "debug", "law.cli_capabilities.loaded", caps);
    return caps;
  } catch (error) {
    await log(client, "debug", "law.cli_capabilities.failed", {
      error: error?.message ?? String(error),
    });
    cliCapabilitiesCache = {
      fetchedAt: Date.now(),
      directory,
      data: baseline,
    };
    return baseline;
  }
}

function getLawPolicyPath(directory, law) {
  const fileName = String(law?.custom?.policyFile || CONFIG.lawPolicyFileName).trim();
  return join(directory, CONFIG.gccDir, fileName || CONFIG.lawPolicyFileName);
}

function getWatchmanSystemPromptPath(directory, law) {
  const configured = String(
    law?.watchman?.systemPromptFile || CONFIG.watchmanSystemPromptFileName
  ).trim();
  return join(directory, CONFIG.gccDir, configured || CONFIG.watchmanSystemPromptFileName);
}

function getFailureLookupPolicyPath(directory, law) {
  const configured = String(
    law?.gcc?.failureLookupPolicyFile || CONFIG.failurePolicyFileName
  ).trim();
  return join(directory, CONFIG.gccDir, configured || CONFIG.failurePolicyFileName);
}

function getResearchCapturePolicyPath(directory, law) {
  const configured = String(
    law?.research?.capturePolicyFile || CONFIG.researchPolicyFileName
  ).trim();
  return join(directory, CONFIG.gccDir, configured || CONFIG.researchPolicyFileName);
}

function getAgentGuidePath(directory, law) {
  const configured = String(law?.agentGuide?.path || "").trim();
  if (!configured) return join(directory, CONFIG.gccDir, CONFIG.agentGuideFileName);
  if (configured.startsWith(CONFIG.gccDir)) {
    return join(directory, configured);
  }
  if (configured.startsWith("/")) {
    return configured;
  }
  return join(directory, configured);
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
  let law = sanitizeLaw(parsed);
  const runtimeConfig = await loadRuntimeCriticConfig(client, directory);
  if (runtimeConfig?.critic && Object.keys(runtimeConfig.critic).length > 0) {
    law = sanitizeLaw(
      deepMerge(law, {
        critic: deepMerge(law.critic, runtimeConfig.critic),
      })
    );
    law.critic.runtimeConfigSources = runtimeConfig.sources || [];
    law.critic.runtimeConfigPaths = runtimeConfig.paths || {};
  }
  const policyPath = getLawPolicyPath(directory, law);
  law.custom.policyPath = policyPath;
  law.custom.policyText = "";
  if (existsSync(policyPath)) {
    try {
      law.custom.policyText = clipText(readFileSync(policyPath, "utf-8"), 15000);
    } catch (error) {
      await log(client, "warn", "law.policy_load_failed", {
        policyPath,
        error: error?.message ?? String(error),
      });
    }
  }
  const watchmanPromptPath = getWatchmanSystemPromptPath(directory, law);
  law.watchman.systemPromptPath = watchmanPromptPath;
  law.watchman.systemPromptText = defaultWatchmanSystemPrompt();
  if (existsSync(watchmanPromptPath)) {
    try {
      const customPrompt = readFileSync(watchmanPromptPath, "utf-8");
      if (customPrompt && customPrompt.trim()) {
        law.watchman.systemPromptText = clipText(customPrompt, 12000);
      }
    } catch (error) {
      await log(client, "warn", "law.watchman_prompt_load_failed", {
        watchmanPromptPath,
        error: error?.message ?? String(error),
      });
    }
  }
  const failurePolicyPath = getFailureLookupPolicyPath(directory, law);
  law.gcc.failureLookupPolicyPath = failurePolicyPath;
  law.gcc.failureLookupPolicyText = defaultFailureLookupPolicyPrompt();
  if (existsSync(failurePolicyPath)) {
    try {
      const customFailurePolicy = readFileSync(failurePolicyPath, "utf-8");
      if (customFailurePolicy && customFailurePolicy.trim()) {
        law.gcc.failureLookupPolicyText = clipText(customFailurePolicy, 12000);
      }
    } catch (error) {
      await log(client, "warn", "law.failure_policy_load_failed", {
        failurePolicyPath,
        error: error?.message ?? String(error),
      });
    }
  }
  const researchPolicyPath = getResearchCapturePolicyPath(directory, law);
  law.research.capturePolicyPath = researchPolicyPath;
  law.research.capturePolicyText = defaultResearchCapturePolicyPrompt();
  if (existsSync(researchPolicyPath)) {
    try {
      const customResearchPolicy = readFileSync(researchPolicyPath, "utf-8");
      if (customResearchPolicy && customResearchPolicy.trim()) {
        law.research.capturePolicyText = clipText(customResearchPolicy, 12000);
      }
    } catch (error) {
      await log(client, "warn", "law.research_policy_load_failed", {
        researchPolicyPath,
        error: error?.message ?? String(error),
      });
    }
  }
  const guidePath = getAgentGuidePath(directory, law);
  law.agentGuide.pathResolved = guidePath;
  law.agentGuide.text = "";
  if (law.agentGuide.includeInWatchmanPayload && existsSync(guidePath)) {
    try {
      law.agentGuide.text = clipText(readFileSync(guidePath, "utf-8"), 18000);
    } catch (error) {
      await log(client, "warn", "law.agent_guide_load_failed", {
        guidePath,
        error: error?.message ?? String(error),
      });
    }
  }
  law.cliCapabilities = await loadOpenContextCliCapabilities(client, directory);
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
  if (typeof args.script === "string") return args.script;
  if (typeof args.input === "string") return args.input;
  if (Array.isArray(args.commands)) return args.commands.join(" && ");
  if (Array.isArray(args.cmd)) return args.cmd.join(" && ");
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

function shouldEvaluateResearchCapture(tool, commandText, args, toolOutput, researchSignal) {
  if (researchSignal) return true;
  if (isMcpTool(tool)) return true;
  const toolName = toLowerSafe(tool);
  if (
    toolName.includes("search") ||
    toolName.includes("fetch") ||
    toolName.includes("crawl") ||
    toolName.includes("extract") ||
    toolName.includes("context7") ||
    toolName.includes("research")
  ) {
    return true;
  }
  const argBlob = safeJsonString(args);
  const outputBlob = safeJsonString(toolOutput);
  const combined = `${commandText}\n${argBlob}\n${outputBlob}`;
  return extractUrls(combined).length > 0;
}

function detectFailureSignal(tool, output, commandText = "") {
  const toolName = toLowerSafe(tool);
  if (toolName.includes("read")) return { detected: false, category: "read_only" };
  const blob = typeof output === "string" ? output : JSON.stringify(output || {});
  const text = toLowerSafe(blob);
  const hasFailureKeyword =
    text.includes("error") ||
    text.includes("failed") ||
    text.includes("traceback") ||
    text.includes("exception") ||
    text.includes("assertionerror") ||
    text.includes("test failed");
  if (!hasFailureKeyword) {
    return { detected: false, category: "none" };
  }

  const usageNoise = [
    "usage:",
    "no such option",
    "invalid option",
    "unknown option",
    "did you mean",
    "command not found",
    "no such file or directory",
  ];
  if (usageNoise.some((needle) => text.includes(needle))) {
    return {
      detected: true,
      category: "usage_noise",
      reason: "Likely CLI usage/exploration noise.",
      excerpt: clipText(blob, 500),
    };
  }

  const environmentNoise = [
    "cannot uninstall",
    "no record file was found",
    "installed by debian",
    "permission denied",
    "connection refused",
    "timed out",
    "network is unreachable",
    "temporary failure",
  ];
  if (environmentNoise.some((needle) => text.includes(needle))) {
    return {
      detected: true,
      category: "environment_noise",
      reason: "Likely environment/dependency noise.",
      excerpt: clipText(blob, 500),
    };
  }

  const implementationSignals = [
    "traceback",
    "assertionerror",
    "test failed",
    "failed tests",
    "compilation failed",
    "build failed",
    "typeerror",
    "syntaxerror",
    "referenceerror",
  ];
  if (implementationSignals.some((needle) => text.includes(needle))) {
    return {
      detected: true,
      category: "implementation_failure",
      reason: "Likely actionable implementation failure.",
      excerpt: clipText(blob, 500),
    };
  }

  if (toolName.includes("bash") && isLikelyReadOnlyBashCommand(commandText)) {
    return {
      detected: true,
      category: "read_only_noise",
      reason: "Failure happened during read-only exploration.",
      excerpt: clipText(blob, 500),
    };
  }

  return {
    detected: true,
    category: "generic_failure",
    reason: "Unclassified failure-like output.",
    excerpt: clipText(blob, 500),
  };
}

function shouldEvaluateFailureLookup(tool, commandText, toolOutput) {
  const toolName = toLowerSafe(tool);
  if (toolName.includes("read")) return false;
  if (toolName === "unknown") return false;
  const outputText = safeJsonString(toolOutput);
  const command = toLowerSafe(commandText);
  if (!outputText.trim() && !command.trim()) return false;
  if (toolName.includes("bash") || toolName.includes("shell")) {
    if (isLikelyReadOnlyBashCommand(commandText)) return false;
    return true;
  }
  if (
    toolName.includes("test") ||
    toolName.includes("build") ||
    toolName.includes("edit") ||
    toolName.includes("write")
  ) {
    return true;
  }
  const text = toLowerSafe(outputText);
  return (
    text.includes("error") ||
    text.includes("failed") ||
    text.includes("exception") ||
    text.includes("traceback")
  );
}

function shouldRequireFailureLookupFallback(signal, commandText = "") {
  if (!signal?.detected) return false;
  if (signal.category === "implementation_failure" || signal.category === "generic_failure") {
    return true;
  }
  // If command is clearly a retry-oriented implementation action, keep safety on.
  const cmd = toLowerSafe(commandText);
  if (
    cmd.includes("pytest") ||
    cmd.includes("npm test") ||
    cmd.includes("pnpm test") ||
    cmd.includes("yarn test") ||
    cmd.includes("cargo test") ||
    cmd.includes("go test") ||
    cmd.includes("npm run build") ||
    cmd.includes("pnpm build") ||
    cmd.includes("yarn build")
  ) {
    return true;
  }
  return false;
}

function isPlanningAgentName(agent, law) {
  const text = toLowerSafe(agent);
  if (!text) return false;
  const patterns = normalizeStringArray(
    law?.custom?.exemptAgentPatterns,
    DEFAULT_LAW.custom.exemptAgentPatterns
  ).map((entry) => entry.toLowerCase());
  return patterns.some((entry) => entry && text.includes(entry));
}

function isLikelyReadOnlyBashCommand(commandText) {
  const raw = String(commandText || "").trim();
  if (!raw) return false;

  // Unwrap common shell wrappers: bash -lc "<command>" / sh -c "<command>".
  const wrapped = raw.match(/^(?:bash|sh|zsh)\s+-[a-z]*c\s+["']([\s\S]+)["']$/i);
  const text = (wrapped ? wrapped[1] : raw).trim().toLowerCase();
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
    isPlanningAgentName(state?.lastAgent, law)
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

async function collectWatchmanEvidence(client, law, state, directory) {
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
  const recentInterruptions = (state.recentInterruptions || [])
    .slice(-law.watchman.includeRecentAlerts)
    .map((entry) => ({
      at: entry.at,
      rule: entry.rule,
      detail: clipText(entry.detail || "", 220),
      source: entry.source || "",
      trigger: entry.trigger || "",
    }));

  const latestInterruptionAt = recentInterruptions.length > 0
    ? toEpochMs(recentInterruptions[recentInterruptions.length - 1].at)
    : 0;
  const postAlertActions = (state.recentToolExecutions || [])
    .filter((entry) => {
      if (!latestInterruptionAt) return true;
      const at = toEpochMs(entry?.time);
      return at >= latestInterruptionAt;
    })
    .slice(-law.watchman.includeRecentActionsAfterAlerts)
    .map((entry) => {
      const commandText = clipText(entry?.commandText || "", 240);
      return {
        time: entry?.time || "",
        tool: entry?.tool || "",
        commandText,
        isCommit: isOpenContextCommitCommand(commandText),
        isContextLookup: isOpenContextContextLookup(commandText),
      };
    });

  const recentDebtTransitions = (state.recentDebtTransitions || [])
    .slice(-20)
    .map((entry) => ({
      at: entry.at,
      source: entry.source || "",
      debt: entry.debt || "",
      action: entry.action || "",
      rule: entry.rule || "",
      before: Boolean(entry.before),
      after: Boolean(entry.after),
    }));

  const historyQuery = buildHistoryQueryFromState(state, [
    latestAssistant?.text || "",
    recentToolCalls.map((entry) => entry?.commandText || "").join("\n"),
    recentToolCalls.map((entry) => entry?.output || "").join("\n"),
    recentInterruptions.map((entry) => `${entry.rule} ${entry.detail}`).join("\n"),
    postAlertActions.map((entry) => entry.commandText || "").join("\n"),
    recentDebtTransitions.map((entry) => `${entry.debt}:${entry.action}`).join("\n"),
  ]);
  const gccHistory = collectGccHistoryEvidence(directory, historyQuery);
  return {
    sessionId,
    recentMessages: summarized,
    latestAssistant,
    recentToolCalls,
    recentInterruptions,
    postAlertActions,
    recentDebtTransitions,
    gccHistory,
    debts: {
      pendingCompactionCheckpoint: state.pendingCompactionCheckpoint,
      pendingCheckpointOverdue: state.pendingCheckpointOverdue,
      pendingResearchCapture: state.pendingResearchCapture,
      pendingFailureLookup: state.pendingFailureLookup,
      sinceCommitCount: state.sinceCommitCount,
      toolExecutionCount: state.toolExecutionCount,
      mcpUsed: state.mcpUsed,
      checkpointThreshold: law?.gcc?.requireCheckpointEveryTools || 0,
      lastCompactionAt: state.lastCompactionAt || 0,
      lastCommitAt: state.lastCommitAt || 0,
      lastContextRecoveryAt: state.lastContextRecoveryAt || 0,
    },
  };
}

function buildLawSummaryForInspector(law) {
  return {
    mode: law.mode,
    gcc: {
      requireInit: law.gcc.requireInit,
      requireCheckpointEveryTools: law.gcc.requireCheckpointEveryTools,
      checkpointDebtJudgeMode: law.gcc.checkpointDebtJudgeMode,
      requireFailedAttemptLookup: law.gcc.requireFailedAttemptLookup,
      failureLookupPolicyFile: law.gcc.failureLookupPolicyFile,
      failureClassifierEnabled: law.gcc.failureClassifierEnabled,
      failureClassifierMinConfidence: law.gcc.failureClassifierMinConfidence,
      failureClassifierRequireModelDecision: law.gcc.failureClassifierRequireModelDecision,
      compactionCheckpointRequired: law.gcc.compactionCheckpointRequired,
      compactionDebtJudgeMode: law.gcc.compactionDebtJudgeMode,
      skipCheckpointDuringPlanningAgent: law.gcc.skipCheckpointDuringPlanningAgent,
      countReadOnlyToolsForCheckpoint: law.gcc.countReadOnlyToolsForCheckpoint,
    },
    mcp: law.mcp,
    research: {
      requireCaptureOnDocsOrGithub: law.research.requireCaptureOnDocsOrGithub,
      docsKeywords: law.research.docsKeywords,
      capturePolicyFile: law.research.capturePolicyFile,
      captureClassifierEnabled: law.research.captureClassifierEnabled,
      captureClassifierMinConfidence: law.research.captureClassifierMinConfidence,
      captureClassifierRequireModelDecision: law.research.captureClassifierRequireModelDecision,
    },
    custom: {
      enabled: law.custom.enabled,
      escalation: law.custom.escalation,
      rules: law.custom.rules.map((rule) => ({
        id: rule.id,
        enabled: rule.enabled,
        description: rule.description,
        severity: rule.severity,
        triggers: rule.triggers,
        when: rule.when,
        require: rule.require,
        interruptAfterViolations: rule.interruptAfterViolations,
      })),
      hints: law.custom.hints,
      policyFile: law.custom.policyFile,
    },
    watchman: {
      enabled: law.watchman.enabled,
      inspectAssistantTurns: law.watchman.inspectAssistantTurns,
      inspectToolCalls: law.watchman.inspectToolCalls,
      inspectCompaction: law.watchman.inspectCompaction,
      inspectOnIdle: law.watchman.inspectOnIdle,
      skipDuringPlanningAgent: law.watchman.skipDuringPlanningAgent,
      dedupeSameViolationUntilResolved: law.watchman.dedupeSameViolationUntilResolved,
      minConfidence: law.watchman.minConfidence,
      requireModelDecision: law.watchman.requireModelDecision,
      systemPromptFile: law.watchman.systemPromptFile,
      includeRecentAlerts: law.watchman.includeRecentAlerts,
      includeRecentActionsAfterAlerts: law.watchman.includeRecentActionsAfterAlerts,
    },
    cliCapabilities: law.cliCapabilities || {},
    runtime: {
      criticConfigSources: law?.critic?.runtimeConfigSources || [],
      criticConfigPaths: law?.critic?.runtimeConfigPaths || {},
    },
    agentGuide: {
      includeInWatchmanPayload: law.agentGuide.includeInWatchmanPayload,
      path: law.agentGuide.path,
    },
  };
}

function includesAny(haystack, needles) {
  const text = toLowerSafe(haystack);
  return normalizeStringArray(needles, []).some((needle) => text.includes(toLowerSafe(needle)));
}

function matchRegexAny(text, patterns) {
  const source = String(text || "");
  for (const pattern of normalizeStringArray(patterns, [])) {
    try {
      const re = new RegExp(pattern, "i");
      if (re.test(source)) return true;
    } catch {
      // Ignore invalid regex patterns from user config.
    }
  }
  return false;
}

function getDebtFlagValue(state, name) {
  const key = String(name || "").trim();
  if (!key) return false;
  const mapping = {
    pendingCompactionCheckpoint: Boolean(state?.pendingCompactionCheckpoint),
    pendingCheckpointOverdue: Boolean(state?.pendingCheckpointOverdue),
    pendingResearchCapture: Boolean(state?.pendingResearchCapture),
    pendingFailureLookup: Boolean(state?.pendingFailureLookup),
    hasViolationDebt: Boolean(state?.hasViolationDebt),
    mcpUsed: Boolean(state?.mcpUsed),
  };
  if (Object.prototype.hasOwnProperty.call(mapping, key)) {
    return mapping[key];
  }
  return false;
}

function collectRecentCommandTexts(state) {
  return state.recentToolExecutions
    .slice(-12)
    .map((entry) => String(entry?.commandText || "").trim())
    .filter(Boolean);
}

function buildHistoryQueryFromState(state, extras = []) {
  const parts = [];
  if (state?.lastAssistantText) parts.push(String(state.lastAssistantText));
  const commands = collectRecentCommandTexts(state).slice(-4);
  if (commands.length > 0) parts.push(commands.join("\n"));
  for (const extra of extras) {
    const text = String(extra || "").trim();
    if (text) parts.push(text);
  }
  return clipText(parts.join("\n\n"), 3000);
}

function shouldInspectCustomRuleForTrigger(rule, trigger) {
  if (!Array.isArray(rule?.triggers) || rule.triggers.length === 0) return true;
  return rule.triggers.includes(trigger);
}

function customRuleWhenMatches(rule, context) {
  const when = rule.when || {};
  const tool = toLowerSafe(context.tool);
  const command = String(context.commandText || "");
  const commandLower = toLowerSafe(command);
  const assistantText = toLowerSafe(context.assistantText);
  const outputText = toLowerSafe(context.toolOutput);
  const corpus = `${tool}\n${commandLower}\n${assistantText}\n${outputText}`;

  if (when.taskKeywords.length > 0 && !includesAny(corpus, when.taskKeywords)) {
    return false;
  }
  if (when.toolIncludes.length > 0 && !includesAny(tool, when.toolIncludes)) {
    return false;
  }
  if (when.toolExcludes.length > 0 && includesAny(tool, when.toolExcludes)) {
    return false;
  }
  if (when.commandIncludes.length > 0 && !includesAny(commandLower, when.commandIncludes)) {
    return false;
  }
  if (when.commandRegex.length > 0 && !matchRegexAny(command, when.commandRegex)) {
    return false;
  }
  if (when.assistantIncludes.length > 0 && !includesAny(assistantText, when.assistantIncludes)) {
    return false;
  }
  if (when.outputIncludes.length > 0 && !includesAny(outputText, when.outputIncludes)) {
    return false;
  }
  if (when.debtFlags.length > 0) {
    const anyDebt = when.debtFlags.some((flag) => getDebtFlagValue(context.state, flag));
    if (!anyDebt) return false;
  }
  return true;
}

function checkCustomRuleRequirement(rule, context) {
  const requirement = rule.require || {};
  const missing = [];
  const recentTools = context.state.recentTools.slice(-12).map((name) => toLowerSafe(name));
  const currentTool = toLowerSafe(context.tool);
  const toolsToCheck = [currentTool, ...recentTools];
  const recentCommands = [
    String(context.commandText || ""),
    ...collectRecentCommandTexts(context.state),
  ];
  const recentCommandBlob = recentCommands.join("\n").toLowerCase();

  if (Array.isArray(requirement.anyTools) && requirement.anyTools.length > 0) {
    const hasAnyRequiredTool = requirement.anyTools.some((expected) => {
      const needle = toLowerSafe(expected);
      return toolsToCheck.some((toolName) => toolName.includes(needle));
    });
    if (!hasAnyRequiredTool) {
      missing.push(`use one of tools: ${requirement.anyTools.join(", ")}`);
    }
  }

  if (Array.isArray(requirement.anyCommands) && requirement.anyCommands.length > 0) {
    const hasAnyRequiredCommand = requirement.anyCommands.some((expected) => {
      const needle = toLowerSafe(expected);
      return recentCommandBlob.includes(needle);
    });
    if (!hasAnyRequiredCommand) {
      missing.push(`run one of commands/patterns: ${requirement.anyCommands.join(", ")}`);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    guidance: requirement.guidance || "",
  };
}

function evaluateCustomRules({ law, state, trigger, tool, commandText, toolOutput }) {
  if (!law.custom.enabled) return [];
  if (isPlanningAgentName(state?.lastAgent, law)) return [];
  const rules = Array.isArray(law.custom.rules) ? law.custom.rules : [];
  const assistantText = state?.lastAssistantText || "";
  const violations = [];

  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (!shouldInspectCustomRuleForTrigger(rule, trigger)) continue;
    const context = {
      law,
      state,
      trigger,
      tool,
      commandText,
      toolOutput,
      assistantText,
    };
    if (!customRuleWhenMatches(rule, context)) continue;
    const requirement = checkCustomRuleRequirement(rule, context);
    if (requirement.ok) continue;

    const commands = [];
    if (Array.isArray(rule.require?.anyCommands) && rule.require.anyCommands.length > 0) {
      for (const cmd of rule.require.anyCommands.slice(0, 4)) {
        commands.push(cmd);
      }
    }
    if (requirement.guidance) {
      commands.push(requirement.guidance);
    }

    violations.push({
      id: rule.id,
      severity: rule.severity || "medium",
      description: rule.description || "",
      interruptAfterViolations: rule.interruptAfterViolations,
      rule: `custom_rule:${rule.id}`,
      detail: requirement.missing.join("; "),
      commands,
      source: "custom_rule",
      useCritic: false,
    });
  }

  return violations;
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
  const staticApiKey = String(law?.critic?.apiKey || "").trim();
  if (staticApiKey) {
    return { apiKey: staticApiKey, sourceEnv: "runtime_config" };
  }
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
  return resolveCriticModelCandidates(law)[0] || DEFAULT_LAW.critic.model;
}

function resolveCriticModelCandidates(law) {
  const modelEnv = typeof law?.critic?.modelEnv === "string" ? law.critic.modelEnv.trim() : "";
  const models = [];
  if (modelEnv && process.env[modelEnv]?.trim()) {
    models.push(process.env[modelEnv].trim());
  }
  const configuredPrimary = String(law?.critic?.model || DEFAULT_LAW.critic.model).trim();
  if (configuredPrimary) models.push(configuredPrimary);
  const fallbackList = normalizeStringArray(
    law?.critic?.modelFallbacks,
    DEFAULT_LAW.critic.modelFallbacks
  );
  for (const fallback of fallbackList) {
    const value = String(fallback || "").trim();
    if (value) models.push(value);
  }
  const deduped = [];
  const seen = new Set();
  for (const value of models) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped.length > 0 ? deduped : [DEFAULT_LAW.critic.model];
}

function resolveCriticResponseFormatPlan(law) {
  const strategy = String(
    law?.critic?.responseFormatStrategy || DEFAULT_LAW.critic.responseFormatStrategy
  ).trim().toLowerCase();
  if (strategy === "json_object") return ["json_object"];
  if (strategy === "json_schema") return ["json_schema"];
  return ["json_schema", "json_object"];
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

function buildJsonObjectResponseFormat() {
  return { type: "json_object" };
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

function extractCompletionDebugText(data) {
  const message = data?.choices?.[0]?.message;
  if (message) {
    const debug = extractMessageTextForDebug(message);
    if (debug) return debug;
  }
  const outputs = Array.isArray(data?.output) ? data.output : [];
  for (const out of outputs) {
    if (typeof out?.content === "string" && out.content.trim()) {
      return out.content;
    }
    const parts = Array.isArray(out?.content) ? out.content : [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text;
      }
      if (typeof part?.output_text === "string" && part.output_text.trim()) {
        return part.output_text;
      }
    }
  }
  return safeJsonString(data || {});
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

  // Some OpenAI-compatible providers return a "responses"-style payload.
  const outputs = Array.isArray(data?.output) ? data.output : [];
  for (const out of outputs) {
    const outObj = tryParseJsonObject(out);
    if (outObj) candidates.push(outObj);
    const parts = Array.isArray(out?.content) ? out.content : [];
    for (const part of parts) {
      const partObj = tryParseJsonObject(part);
      if (partObj) candidates.push(partObj);
      if (typeof part?.text === "string") {
        const parsedText = tryParseJsonObject(part.text);
        if (parsedText) candidates.push(parsedText);
      }
      if (typeof part?.output_text === "string") {
        const parsedOutputText = tryParseJsonObject(part.output_text);
        if (parsedOutputText) candidates.push(parsedOutputText);
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildLawModelRequest({
  law,
  model,
  messages,
  maxTokens,
  schemaName,
  schema,
  responseFormatType = "json_schema",
}) {
  const requestOverrides = law?.critic?.request && typeof law.critic.request === "object"
    ? law.critic.request
    : {};
  const responseFormat = responseFormatType === "json_object"
    ? buildJsonObjectResponseFormat()
    : buildStructuredResponseFormat(schemaName, schema);
  const body = {
    ...requestOverrides,
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: responseFormat,
  };
  return body;
}

function withStrictRetrySystemMessage(messages, schemaName) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return list;
  const [first, ...rest] = list;
  const firstText = typeof first?.content === "string" ? first.content : safeJsonString(first?.content);
  const strictSuffix =
    `\n\nSTRICT RETRY: previous output was invalid. Return ONLY valid JSON for schema '${schemaName}'. ` +
    "No prose. No markdown. No extra keys.";
  return [
    {
      ...(first || {}),
      content: `${firstText}${strictSuffix}`,
    },
    ...rest,
  ];
}

function isValidCriticParsed(parsed) {
  return parsed && typeof parsed === "object" && typeof parsed.enforce === "boolean";
}

function isValidWatchmanParsed(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.violation === "boolean" &&
    typeof parsed.rule === "string" &&
    typeof parsed.reason === "string" &&
    typeof parsed.correction_prompt === "string" &&
    typeof parsed.confidence === "number"
  );
}

function normalizeDebtUpdateAction(value) {
  const action = String(value || "").trim().toLowerCase();
  if (["open", "clear", "keep"].includes(action)) return action;
  return "keep";
}

function extractWatchmanDebtUpdates(parsed) {
  const raw = parsed?.debt_updates;
  if (!raw || typeof raw !== "object") {
    return {
      pendingCompactionCheckpoint: "keep",
      pendingCheckpointOverdue: "keep",
    };
  }
  return {
    pendingCompactionCheckpoint: normalizeDebtUpdateAction(raw.pendingCompactionCheckpoint),
    pendingCheckpointOverdue: normalizeDebtUpdateAction(raw.pendingCheckpointOverdue),
  };
}

function isValidFailureLookupParsed(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.require_lookup === "boolean" &&
    typeof parsed.reason === "string"
  );
}

function isValidResearchCaptureParsed(parsed) {
  return (
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.require_capture === "boolean" &&
    typeof parsed.reason === "string"
  );
}

async function requestStructuredVerdict({
  law,
  apiKey,
  model,
  models,
  timeoutMs,
  schemaName,
  schema,
  maxTokens,
  messages,
  isValidParsed,
}) {
  const retries = Math.max(0, Number(law?.critic?.strictJsonRetryAttempts || 0));
  const modelCandidates = Array.isArray(models) && models.length > 0
    ? models
    : [model || resolveCriticModel(law)];
  const responseFormats = resolveCriticResponseFormatPlan(law);
  let totalAttempts = 0;
  let lastFailure = null;

  for (const modelCandidate of modelCandidates) {
    for (const responseFormatType of responseFormats) {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const attemptMessages = attempt === 0
          ? messages
          : withStrictRetrySystemMessage(messages, schemaName);
        totalAttempts += 1;
        const result = await callLawModel({
          law,
          apiKey,
          model: modelCandidate,
          timeoutMs,
          body: buildLawModelRequest({
            law,
            model: modelCandidate,
            messages: attemptMessages,
            maxTokens,
            schemaName,
            schema,
            responseFormatType,
          }),
        });

        if (!result.ok) {
          lastFailure = {
            ok: false,
            source: "http_error",
            status: result.status,
            raw: result.raw,
            attempts: totalAttempts,
            model: modelCandidate,
            responseFormat: responseFormatType,
          };
          break;
        }

        if (!result.parsed) {
          lastFailure = {
            ok: false,
            source: "parse_invalid_json",
            raw: result.raw,
            attempts: totalAttempts,
            model: modelCandidate,
            responseFormat: responseFormatType,
          };
          continue;
        }

        if (!isValidParsed(result.parsed)) {
          lastFailure = {
            ok: false,
            source: "parse_invalid_shape",
            raw: clipText(safeJsonString(result.parsed), 500),
            attempts: totalAttempts,
            model: modelCandidate,
            responseFormat: responseFormatType,
          };
          continue;
        }

        return {
          ok: true,
          parsed: result.parsed,
          raw: result.raw,
          attempts: totalAttempts,
          modelUsed: modelCandidate,
          responseFormat: responseFormatType,
        };
      }
    }
  }

  return lastFailure || {
    ok: false,
    source: "parse_invalid_json",
    raw: "",
    attempts: Math.max(1, totalAttempts),
    model: modelCandidates[0],
    responseFormat: responseFormats[0],
  };
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
      raw: clipText(extractCompletionDebugText(data), 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runCriticCheck(client, law, payload) {
  if (!law.critic.enabled) return { enforce: true, source: "disabled" };
  const { apiKey, sourceEnv } = resolveCriticApiKey(law);
  if (!apiKey) return { enforce: true, source: "no_api_key" };
  const models = resolveCriticModelCandidates(law);
  const primaryModel = models[0];

  try {
    const result = await requestStructuredVerdict({
      law,
      apiKey,
      model: primaryModel,
      models,
      timeoutMs: law.critic.timeoutMs || 3500,
      schemaName: "opencontext_critic",
      schema: CRITIC_RESPONSE_SCHEMA,
      maxTokens: law.critic.maxTokensCritic || 120,
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
      isValidParsed: isValidCriticParsed,
    });
    if (!result.ok) {
      return {
        enforce: true,
        source: result.source || "http_error",
        status: result.status,
        raw: result.raw,
        apiKeyEnv: sourceEnv,
        attempts: result.attempts || 1,
        model: result.model || primaryModel,
      };
    }
    const parsed = result.parsed;
    const enforce = parsed?.enforce !== false;
    return {
      enforce,
      source: "critic",
      reason: parsed?.reason || "",
      attempts: result.attempts || 1,
      model: result.modelUsed || primaryModel,
    };
  } catch (error) {
    return {
      enforce: true,
      source: "critic_error",
      error: error?.message ?? String(error),
      apiKeyEnv: sourceEnv,
    };
  }
}

async function runFailureLookupClassifier(client, law, payload) {
  if (!law?.gcc?.failureClassifierEnabled) {
    return { available: false, requireLookup: false, source: "classifier_disabled" };
  }
  if (!law?.critic?.enabled) {
    return { available: false, requireLookup: false, source: "critic_disabled" };
  }

  const { apiKey, sourceEnv } = resolveCriticApiKey(law);
  if (!apiKey) {
    return { available: false, requireLookup: false, source: "no_api_key" };
  }
  const models = resolveCriticModelCandidates(law);
  const primaryModel = models[0];

  try {
    const result = await requestStructuredVerdict({
      law,
      apiKey,
      model: primaryModel,
      models,
      timeoutMs: law.critic.timeoutMs || 8000,
      schemaName: "opencontext_failure_lookup",
      schema: FAILURE_LOOKUP_RESPONSE_SCHEMA,
      maxTokens: Math.min(
        320,
        Math.max(64, Number(law.critic.maxTokensCritic || 120))
      ),
      messages: [
        {
          role: "system",
          content:
            law?.gcc?.failureLookupPolicyText || defaultFailureLookupPolicyPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      isValidParsed: isValidFailureLookupParsed,
    });
    if (!result.ok) {
      return {
        available: false,
        requireLookup: false,
        source: result.source || "http_error",
        status: result.status,
        error: result.raw,
        attempts: result.attempts || 1,
        model: result.model || primaryModel,
        responseFormat: result.responseFormat || "",
        apiKeyEnv: sourceEnv,
      };
    }
    const parsed = result.parsed;
    const confidence = Number(parsed?.confidence ?? 0);
    const minConfidence = Number(law?.gcc?.failureClassifierMinConfidence ?? 0.55);
    const requireLookup = parsed?.require_lookup === true && confidence >= minConfidence;
    return {
      available: true,
      requireLookup,
      source: "failure_classifier_model",
      reason: clipText(parsed?.reason || "", 300),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      threshold: minConfidence,
      model: result.modelUsed || primaryModel,
      responseFormat: result.responseFormat || "",
      apiKeyEnv: sourceEnv,
      attempts: result.attempts || 1,
    };
  } catch (error) {
    return {
      available: false,
      requireLookup: false,
      source: "failure_classifier_error",
      error: error?.message ?? String(error),
      model: primaryModel,
      apiKeyEnv: sourceEnv,
    };
  }
}

async function runResearchCaptureClassifier(client, law, payload) {
  if (!law?.research?.captureClassifierEnabled) {
    return { available: false, requireCapture: false, source: "classifier_disabled" };
  }
  if (!law?.critic?.enabled) {
    return { available: false, requireCapture: false, source: "critic_disabled" };
  }

  const { apiKey, sourceEnv } = resolveCriticApiKey(law);
  if (!apiKey) {
    return { available: false, requireCapture: false, source: "no_api_key" };
  }
  const models = resolveCriticModelCandidates(law);
  const primaryModel = models[0];

  try {
    const result = await requestStructuredVerdict({
      law,
      apiKey,
      model: primaryModel,
      models,
      timeoutMs: law.critic.timeoutMs || 8000,
      schemaName: "opencontext_research_capture",
      schema: RESEARCH_CAPTURE_RESPONSE_SCHEMA,
      maxTokens: Math.min(
        320,
        Math.max(64, Number(law.critic.maxTokensCritic || 120))
      ),
      messages: [
        {
          role: "system",
          content:
            law?.research?.capturePolicyText || defaultResearchCapturePolicyPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      isValidParsed: isValidResearchCaptureParsed,
    });
    if (!result.ok) {
      return {
        available: false,
        requireCapture: false,
        source: result.source || "http_error",
        status: result.status,
        error: result.raw,
        attempts: result.attempts || 1,
        model: result.model || primaryModel,
        responseFormat: result.responseFormat || "",
        apiKeyEnv: sourceEnv,
      };
    }
    const parsed = result.parsed;
    const confidence = Number(parsed?.confidence ?? 0);
    const minConfidence = Number(law?.research?.captureClassifierMinConfidence ?? 0.55);
    const requireCapture = parsed?.require_capture === true && confidence >= minConfidence;
    return {
      available: true,
      requireCapture,
      source: "research_classifier_model",
      reason: clipText(parsed?.reason || "", 300),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      threshold: minConfidence,
      model: result.modelUsed || primaryModel,
      responseFormat: result.responseFormat || "",
      apiKeyEnv: sourceEnv,
      attempts: result.attempts || 1,
    };
  } catch (error) {
    return {
      available: false,
      requireCapture: false,
      source: "research_classifier_error",
      error: error?.message ?? String(error),
      model: primaryModel,
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
  const models = resolveCriticModelCandidates(law);
  const primaryModel = models[0];

  try {
    const result = await requestStructuredVerdict({
      law,
      apiKey,
      model: primaryModel,
      models,
      timeoutMs: law.critic.timeoutMs || 8000,
      schemaName: "opencontext_watchman",
      schema: WATCHMAN_RESPONSE_SCHEMA,
      maxTokens: law.critic.maxTokensWatchman || 320,
      messages: [
        {
          role: "system",
          content:
            law?.watchman?.systemPromptText || defaultWatchmanSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      isValidParsed: isValidWatchmanParsed,
    });
    if (!result.ok) {
      return {
        available: false,
        violation: false,
        source: result.source || "http_error",
        status: result.status,
        error: result.raw,
        apiKeyEnv: sourceEnv,
        model: result.model || primaryModel,
        responseFormat: result.responseFormat || "",
        attempts: result.attempts || 1,
      };
    }
    const parsed = result.parsed;
    const violation = parsed?.violation === true;
    const rule = clipText(parsed?.rule || "watchman_policy_violation", 120);
    const reason = clipText(parsed?.reason || "Policy violation detected by watchman model.", 400);
    const correctionPrompt = clipText(parsed?.correction_prompt || "", 2500);
    const confidence = Number(parsed?.confidence ?? 0);
    const debtUpdates = extractWatchmanDebtUpdates(parsed);
    const satisfactionEvidence = clipText(parsed?.satisfaction_evidence || "", 600);
    return {
      available: true,
      violation,
      source: "watchman_model",
      rule,
      reason,
      correctionPrompt,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      debtUpdates,
      satisfactionEvidence,
      model: result.modelUsed || primaryModel,
      responseFormat: result.responseFormat || "",
      apiKeyEnv: sourceEnv,
      attempts: result.attempts || 1,
    };
  } catch (error) {
    return {
      available: false,
      violation: false,
      source: "watchman_error",
      error: error?.message ?? String(error),
      apiKeyEnv: sourceEnv,
      model: primaryModel,
    };
  }
}

async function maybeInterrupt(client, directory, law, state, violation) {
  const now = Date.now();
  const minGap = law.cooldowns.interruptionSeconds * 1000;
  const sameRuleGap = law.cooldowns.sameRuleSeconds * 1000;
  const lastForRule = state.lastRuleInjectionAt[violation.rule] || 0;
  const applyDebtDedupe =
    law?.watchman?.dedupeSameViolationUntilResolved !== false &&
    violation?.source !== "custom_rule";

  if (applyDebtDedupe && state.ruleDebtOpen?.[violation.rule]) {
    await log(client, "debug", "law.interrupt.skipped_open_debt", {
      sessionId: state.sessionId,
      rule: violation.rule,
      source: violation.source || "deterministic",
    });
    return false;
  }

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
      attempts: verdict.attempts || 1,
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
    if (applyDebtDedupe) {
      state.ruleDebtOpen[violation.rule] = true;
    }
    appendBounded(
      state.recentInterruptions,
      {
        at: new Date(now).toISOString(),
        rule: violation.rule,
        detail: violation.detail,
        source: violation.source || "deterministic",
        trigger: violation.trigger || "",
      },
      40
    );
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

function clearRuleDebt(state, ruleName) {
  if (!state?.ruleDebtOpen) return;
  if (!ruleName) return;
  delete state.ruleDebtOpen[ruleName];
}

function recomputeViolationDebt(state) {
  if (!state) return;
  const hasRuleDebt =
    state.ruleDebtOpen && typeof state.ruleDebtOpen === "object"
      ? Object.keys(state.ruleDebtOpen).length > 0
      : false;
  state.hasViolationDebt = Boolean(
    hasRuleDebt ||
      state.pendingCompactionCheckpoint ||
      state.pendingCheckpointOverdue ||
      state.pendingResearchCapture ||
      state.pendingFailureLookup
  );
}

function pushDebtTransition(state, payload) {
  if (!state) return;
  appendBounded(
    state.recentDebtTransitions,
    {
      at: new Date().toISOString(),
      ...payload,
    },
    30
  );
}

function applyWatchmanDebtUpdates(state, debtUpdates, ruleName = "") {
  if (!state || !debtUpdates) return;
  const updates = {
    pendingCompactionCheckpoint: debtUpdates.pendingCompactionCheckpoint || "keep",
    pendingCheckpointOverdue: debtUpdates.pendingCheckpointOverdue || "keep",
  };

  for (const [key, action] of Object.entries(updates)) {
    if (action === "keep") continue;
    const before = Boolean(state[key]);
    if (action === "open") {
      state[key] = true;
      pushDebtTransition(state, {
        source: "watchman",
        debt: key,
        action: "open",
        before,
        after: true,
        rule: ruleName || "",
      });
      continue;
    }
    if (action === "clear") {
      state[key] = false;
      pushDebtTransition(state, {
        source: "watchman",
        debt: key,
        action: "clear",
        before,
        after: false,
        rule: ruleName || "",
      });
      if (key === "pendingCompactionCheckpoint") {
        clearRuleDebt(state, "compaction_checkpoint_required");
      }
      if (key === "pendingCheckpointOverdue") {
        clearRuleDebt(state, "checkpoint_overdue");
      }
    }
  }
  recomputeViolationDebt(state);
}

function shouldHardInterruptCustomRule(law, violationCount, ruleSpecificThreshold = null) {
  const mode = law?.custom?.escalation?.mode || "soft_then_hard";
  if (mode === "soft_only") return false;
  if (mode === "hard_only") return true;
  const thresholdDefault = Number(law?.custom?.escalation?.hardInterruptThreshold ?? 2);
  const threshold = ruleSpecificThreshold || thresholdDefault;
  return violationCount >= Math.max(1, threshold);
}

function shouldEmitSoftReminder(law, violationCount) {
  const mode = law?.custom?.escalation?.mode || "soft_then_hard";
  if (mode === "hard_only") return false;
  const softBeforeInterrupt = Number(law?.custom?.escalation?.softViolationsBeforeInterrupt ?? 1);
  return violationCount <= Math.max(0, softBeforeInterrupt);
}

async function maybeHandleCustomRuleViolation(client, directory, law, state, violation) {
  if (!violation?.id) return false;
  const ruleKey = String(violation.id);
  const nextCount = Number(state.customRuleViolations[ruleKey] || 0) + 1;
  state.customRuleViolations[ruleKey] = nextCount;

  const now = Date.now();
  const reminderCooldownMs = Math.max(
    0,
    Number(law?.custom?.escalation?.reminderCooldownSeconds || 0) * 1000
  );
  const lastReminderAt = Number(state.customRuleReminderAt[ruleKey] || 0);

  await appendLawTrace(client, directory, law, {
    type: "law.custom.violation",
    sessionId: state.sessionId,
    trigger: violation.trigger || "",
    rule: {
      id: ruleKey,
      severity: violation.severity || "medium",
      count: nextCount,
      description: violation.description || "",
    },
    detail: violation.detail,
    commands: violation.commands || [],
  });

  const hardInterrupt = shouldHardInterruptCustomRule(
    law,
    nextCount,
    violation.interruptAfterViolations
  );
  if (hardInterrupt) {
    return await maybeInterrupt(client, directory, law, state, violation);
  }

  const shouldSoftRemind = shouldEmitSoftReminder(law, nextCount);
  if (!shouldSoftRemind) return false;
  if (reminderCooldownMs > 0 && now - lastReminderAt < reminderCooldownMs) return false;

  state.customRuleReminderAt[ruleKey] = now;
  await log(client, "warn", "law.custom.reminder", {
    sessionId: state.sessionId,
    rule: ruleKey,
    count: nextCount,
    detail: violation.detail,
  });
  const reminderCommands = Array.isArray(violation.commands) && violation.commands.length > 0
    ? `\nExpected action:\n- ${violation.commands.join("\n- ")}`
    : "";
  await toast(client, {
    type: "warning",
    timeout: 10000,
    message:
      `⚖️ Law Enforcer reminder (${ruleKey})\n${violation.detail}${reminderCommands}`,
  });
  return false;
}

function buildFailureLookupCommands(law) {
  const caps = law?.cliCapabilities || {};
  const commands = [];
  if (caps.contextSearch) {
    const searchCmd = caps.contextLimit
      ? 'opencontext context --search "<feature or failure>" --limit 20'
      : 'opencontext context --search "<feature or failure>"';
    commands.push(searchCmd);
  }
  if (caps.contextLog || !caps.available) {
    commands.push("opencontext context --log --lines 80");
  }
  if (commands.length === 0) {
    commands.push("opencontext context");
  }
  return commands;
}

function buildViolations({
  directory,
  law,
  state,
  tool,
  commandText,
  toolOutput,
  hasGCC,
  planningAgentActive,
  trigger,
}) {
  const violations = [];
  const checkpointEvery = law.gcc.requireCheckpointEveryTools;
  const checkpointJudgeMode = normalizeDebtJudgeMode(
    law?.gcc?.checkpointDebtJudgeMode,
    DEFAULT_LAW.gcc.checkpointDebtJudgeMode
  );
  const compactionJudgeMode = normalizeDebtJudgeMode(
    law?.gcc?.compactionDebtJudgeMode,
    DEFAULT_LAW.gcc.compactionDebtJudgeMode
  );
  const checkpointDeterministic =
    checkpointJudgeMode === "deterministic" ||
    checkpointJudgeMode === "model_first_fallback";
  const compactionDeterministic =
    compactionJudgeMode === "deterministic" ||
    compactionJudgeMode === "model_first_fallback";

  if (law.gcc.requireInit && !hasGCC) {
    violations.push({
      rule: "gcc_init_required",
      detail: "GCC is not initialized in this project directory.",
      commands: ['opencontext init --project-name "<name>" --goal "<goal>"'],
      useCritic: false,
    });
    return violations;
  }

  if (law.gcc.compactionCheckpointRequired && compactionDeterministic && state.pendingCompactionCheckpoint) {
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
    checkpointDeterministic &&
    trigger !== "tool_call" &&
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
        commands: buildFailureLookupCommands(law),
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

function buildModelDebtCandidates({ law, state, trigger, hasGCC }) {
  const candidates = [];
  if (!hasGCC) return candidates;

  const checkpointMode = normalizeDebtJudgeMode(
    law?.gcc?.checkpointDebtJudgeMode,
    DEFAULT_LAW.gcc.checkpointDebtJudgeMode
  );
  const compactionMode = normalizeDebtJudgeMode(
    law?.gcc?.compactionDebtJudgeMode,
    DEFAULT_LAW.gcc.compactionDebtJudgeMode
  );

  if (checkpointMode === "model_only") {
    candidates.push({
      rule: "checkpoint_overdue",
      detail:
        "Model should decide whether checkpoint debt is open based on sinceCommitCount, recent commits, and current implementation progress.",
      commands: ['opencontext commit "Checkpoint after significant progress"'],
      facts: {
        sinceCommitCount: Number(state?.sinceCommitCount || 0),
        checkpointThreshold: Number(law?.gcc?.requireCheckpointEveryTools || 0),
        trigger,
      },
    });
  }

  if (compactionMode === "model_only" && law?.gcc?.compactionCheckpointRequired) {
    candidates.push({
      rule: "compaction_checkpoint_required",
      detail:
        "Model should decide compaction recovery debt using recent interruption history and post-alert actions (commit/context recovery already done or not).",
      commands: [
        'opencontext commit "Post-compaction checkpoint"',
        'opencontext context --log --lines 80',
      ],
      facts: {
        pendingCompactionCheckpoint: Boolean(state?.pendingCompactionCheckpoint),
        lastCompactionAt: Number(state?.lastCompactionAt || 0),
        lastCommitAt: Number(state?.lastCommitAt || 0),
        lastContextRecoveryAt: Number(state?.lastContextRecoveryAt || 0),
        trigger,
      },
    });
  }

  return candidates;
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
    trigger,
    tool: tool || "unknown",
    commandText: commandText || "",
    toolOutput: toolOutput || "",
    hasGCC,
    planningAgentActive: isPlanningAgentName(state?.lastAgent, law),
  });
  const modelDebtCandidates = buildModelDebtCandidates({
    law,
    state,
    trigger,
    hasGCC,
  });

  if (violations.length > 0) {
    violationDetected = true;
    await log(client, "warn", "law.violation.detected", {
      sessionId: state.sessionId,
      rule: violations[0].rule,
      trigger,
    });
  }

  const customViolations = evaluateCustomRules({
    law,
    state,
    trigger,
    tool: tool || "unknown",
    commandText: commandText || "",
    toolOutput: toolOutput || "",
  });
  if (customViolations.length > 0) {
    violationDetected = true;
    const primary = {
      ...customViolations[0],
      trigger,
    };
    await log(client, "warn", "law.custom.violation.detected", {
      sessionId: state.sessionId,
      trigger,
      rule: primary.id,
      severity: primary.severity,
    });
    const interrupted = await maybeHandleCustomRuleViolation(
      client,
      directory,
      law,
      state,
      primary
    );
    if (interrupted) return true;
  }

  const compactionJudgeMode = normalizeDebtJudgeMode(
    law?.gcc?.compactionDebtJudgeMode,
    DEFAULT_LAW.gcc.compactionDebtJudgeMode
  );
  const hardInvariantRules = new Set(["gcc_init_required"]);
  if (compactionJudgeMode !== "model_only") {
    hardInvariantRules.add("compaction_checkpoint_required");
  }
  const pickFallbackViolation = (allowPolicyFallback) =>
    violations.find((item) => hardInvariantRules.has(item.rule)) ||
    (allowPolicyFallback ? violations[0] : null);

  const shouldRunWatchman =
    law.watchman.enabled &&
    ((trigger === "assistant_turn" && law.watchman.inspectAssistantTurns) ||
      (trigger === "tool_call" && law.watchman.inspectToolCalls) ||
      (trigger === "compaction" && law.watchman.inspectCompaction) ||
      (trigger === "idle" && law.watchman.inspectOnIdle)) &&
    !(law.watchman.skipDuringPlanningAgent && isPlanningAgentName(state?.lastAgent, law));

  if (!shouldRunWatchman || state.inspectorInFlight) {
    const allowPolicyFallback =
      !law?.watchman?.enabled || !law?.watchman?.requireModelDecision;
    const fallbackViolation = pickFallbackViolation(allowPolicyFallback);
    if (fallbackViolation) {
      const injected = await maybeInterrupt(client, directory, law, state, fallbackViolation);
      if (injected) return true;
    }
    if (!violationDetected) {
      state.consecutiveInjections = 0;
    }
    return false;
  }

  state.inspectorInFlight = true;
  try {
    const evidence = await collectWatchmanEvidence(client, law, state, directory);
    const latestAssistant =
      evidence.latestAssistant || {
        id: state.lastAssistantMessageId || "",
        role: "assistant",
        agent: state.lastAgent || "",
        modelID: state?.lastModel?.modelID || "",
        finish: "",
        text: clipText(state.lastAssistantText || "", 2000),
        partTypes: [],
        time: {},
      };

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
      lawPolicyText: law?.custom?.policyText || "",
      watchmanSystemPromptText: law?.watchman?.systemPromptText || "",
      failureLookupPolicyText: law?.gcc?.failureLookupPolicyText || "",
      researchCapturePolicyText: law?.research?.capturePolicyText || "",
      agentGuideText: law?.agentGuide?.includeInWatchmanPayload ? law?.agentGuide?.text || "" : "",
      latestAssistant,
      recentMessages: evidence.recentMessages,
      recentToolCalls: evidence.recentToolCalls,
      gccHistory: evidence.gccHistory,
      debts: evidence.debts,
      customRuleCounters: state.customRuleViolations,
      deterministicCandidates: [...violations, ...modelDebtCandidates].map((violation) => ({
        rule: violation.rule,
        detail: violation.detail,
        commands: violation.commands || [],
        facts: violation.facts || {},
      })),
    };
    await appendLawTrace(client, directory, law, {
      type: "watchman.request",
      sessionId: state.sessionId,
      trigger,
      model: resolveCriticModel(law),
      modelCandidates: resolveCriticModelCandidates(law),
      evidence: {
        latestAssistant,
        recentMessages: evidence.recentMessages,
        recentToolCalls: evidence.recentToolCalls,
        recentInterruptions: evidence.recentInterruptions,
        postAlertActions: evidence.postAlertActions,
        recentDebtTransitions: evidence.recentDebtTransitions,
        gccHistory: {
          currentBranch: evidence?.gccHistory?.currentBranch || "",
          semanticMatches: (evidence?.gccHistory?.semanticMatches || []).slice(0, 3),
        },
        debts: evidence.debts,
        customRuleCounters: state.customRuleViolations,
        lawPolicyText: clipText(law?.custom?.policyText || "", 1200),
        watchmanSystemPromptText: clipText(law?.watchman?.systemPromptText || "", 1000),
        failureLookupPolicyText: clipText(law?.gcc?.failureLookupPolicyText || "", 800),
        researchCapturePolicyText: clipText(law?.research?.capturePolicyText || "", 800),
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
      responseFormat: verdict.responseFormat || "",
      apiKeyEnv: verdict.apiKeyEnv || "",
      status: verdict.status || 0,
      error: verdict.error || "",
      raw: verdict.raw || "",
      attempts: verdict.attempts || 1,
      debtUpdates: verdict.debtUpdates || {},
      satisfactionEvidence: verdict.satisfactionEvidence || "",
    });

    applyWatchmanDebtUpdates(state, verdict?.debtUpdates, verdict?.rule || "");

    const minConfidence = Number(law?.watchman?.minConfidence ?? 0.65);
    const confidence = Number(verdict?.confidence ?? 0);
    const modelViolation =
      verdict.available &&
      verdict.violation === true &&
      Number.isFinite(confidence) &&
      confidence >= minConfidence;

      if (!modelViolation) {
        if (latestAssistant.id) {
          state.lastInspectedAssistantMessageId = latestAssistant.id;
        }
        if (verdict.available && !verdict.violation) {
        clearRuleDebt(state, "watchman_policy_violation");
        for (const key of Object.keys(state.ruleDebtOpen || {})) {
          if (String(key).startsWith("watchman_")) {
            clearRuleDebt(state, key);
          }
        }
        recomputeViolationDebt(state);
      }
      if (verdict.available && verdict.violation && confidence < minConfidence) {
        await log(client, "info", "law.watchman.low_confidence_skip", {
          sessionId: state.sessionId,
          trigger,
          confidence,
          minConfidence,
          rule: verdict.rule || "",
        });
      }
      const allowPolicyFallback = !verdict.available && !law?.watchman?.requireModelDecision;
      const fallbackViolation = pickFallbackViolation(allowPolicyFallback);
      if (fallbackViolation) {
        const injected = await maybeInterrupt(client, directory, law, state, fallbackViolation);
        if (injected) return true;
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
      detail:
        verdict.reason ||
        "Law Enforcer detected a policy violation.",
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
          state.customRuleViolations = {};
          state.customRuleReminderAt = {};
          state.ruleDebtOpen = {};
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
        const caps = law?.cliCapabilities || {};
        if (!caps.available || !caps.contextSearch) {
          await toast(client, {
            type: "warning",
            timeout: 9000,
            message:
              "⚠️ OpenContext CLI capability mismatch detected.\n`opencontext context --search` is unavailable in current PATH version.",
          });
        } else if (!caps.contextLimit) {
          await toast(client, {
            type: "info",
            timeout: 7000,
            message:
              "ℹ️ `opencontext context` supports --search but not --limit.\nLaw Enforcer will use compatibility-safe commands.",
          });
        }
      }

      if (event.type === "session.compacted") {
        await log(client, "debug", "event session.compacted");
        if (state) {
          state.lastCompactionAt = Date.now();
          const compactionMode = normalizeDebtJudgeMode(
            law?.gcc?.compactionDebtJudgeMode,
            DEFAULT_LAW.gcc.compactionDebtJudgeMode
          );
          if (
            law?.gcc?.compactionCheckpointRequired &&
            (compactionMode === "deterministic" || compactionMode === "model_first_fallback")
          ) {
            state.pendingCompactionCheckpoint = true;
            state.hasViolationDebt = true;
            pushDebtTransition(state, {
              source: "compaction_event",
              debt: "pendingCompactionCheckpoint",
              action: "open",
              before: false,
              after: true,
              rule: "compaction_checkpoint_required",
            });
          }
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
        const compactionMode = normalizeDebtJudgeMode(
          law?.gcc?.compactionDebtJudgeMode,
          DEFAULT_LAW.gcc.compactionDebtJudgeMode
        );
        if (compactionMode === "model_only") {
          await toast(client, {
            message:
              "⚠️ Context compacted.\nLaw Enforcer is evaluating recovery needs from recent actions/history.",
            type: "info",
            timeout: 9000,
          });
        } else {
          await toast(client, {
            message:
              "⚠️ Context compacted.\nCheckpoint now: opencontext commit \"<summary>\"\nThen recover details with: opencontext context --log --lines 80",
            type: "warning",
            timeout: 10000,
          });
        }

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
      const compactionMode = normalizeDebtJudgeMode(
        law?.gcc?.compactionDebtJudgeMode,
        DEFAULT_LAW.gcc.compactionDebtJudgeMode
      );

      const reminder = hasGCC
        ? compactionMode === "model_only"
          ? `OpenContext Law Enforcer: context is being compacted. Recovery obligations will be judged from recent actions/history. Preserve progress and follow any recovery prompt if issued. Mode=${law.mode}.`
          : `OpenContext Law Enforcer: context is being compacted. Required: \`opencontext commit "<summary>"\`, then \`opencontext context --log --lines 80\`. Mode=${law.mode}.`
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
      if (law?.custom?.enabled) {
        const policyText = clipText(law?.custom?.policyText || "", 1800);
        const hints = law?.custom?.hints || {};
        const hintLines = [];
        if (Array.isArray(hints.availableTools) && hints.availableTools.length > 0) {
          hintLines.push(`Preferred tools: ${hints.availableTools.join(", ")}`);
        }
        if (Array.isArray(hints.availableSkills) && hints.availableSkills.length > 0) {
          hintLines.push(`Preferred skills: ${hints.availableSkills.join(", ")}`);
        }
        if (Array.isArray(hints.preferredCommands) && hints.preferredCommands.length > 0) {
          hintLines.push(`Preferred commands: ${hints.preferredCommands.join(" | ")}`);
        }
        if (Array.isArray(hints.importantMcpServers) && hints.importantMcpServers.length > 0) {
          hintLines.push(`Important MCP servers: ${hints.importantMcpServers.join(", ")}`);
        }
        if (policyText) {
          output.system.push(
            `OpenContext Custom Policy (from .GCC/${law.custom.policyFile}):\n${policyText}`
          );
        }
        if (hintLines.length > 0) {
          output.system.push(`OpenContext Custom Hints:\n- ${hintLines.join("\n- ")}`);
        }
      }

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
- Checkpoint/compaction debt may be model-judged from recent actions and history evidence.
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

      const checkpointMode = normalizeDebtJudgeMode(
        law?.gcc?.checkpointDebtJudgeMode,
        DEFAULT_LAW.gcc.checkpointDebtJudgeMode
      );
      const checkpointDeterministic =
        checkpointMode === "deterministic" ||
        checkpointMode === "model_first_fallback";
      const compactionMode = normalizeDebtJudgeMode(
        law?.gcc?.compactionDebtJudgeMode,
        DEFAULT_LAW.gcc.compactionDebtJudgeMode
      );
      const compactionDeterministic =
        compactionMode === "deterministic" ||
        compactionMode === "model_first_fallback";

      await log(client, "debug", "hook tool.execute.after", {
        tool,
        toolExecutionCount: state.toolExecutionCount,
        sinceCommitCount: state.sinceCommitCount,
        hasGCC,
      });

      if (isMcpTool(tool)) {
        state.mcpUsed = true;
        clearRuleDebt(state, "mcp_usage_expected");
      }

      if (isOpenContextCommitCommand(commandText)) {
        state.lastCommitAt = Date.now();
        state.sinceCommitCount = 0;
        const hadCompactionDebt = Boolean(state.pendingCompactionCheckpoint);
        state.pendingCompactionCheckpoint = false;
        if (hadCompactionDebt) {
          pushDebtTransition(state, {
            source: "action_signal",
            debt: "pendingCompactionCheckpoint",
            action: "clear",
            before: true,
            after: false,
            rule: "compaction_checkpoint_required",
          });
        }
        const hadCheckpointDebt = Boolean(state.pendingCheckpointOverdue);
        state.pendingCheckpointOverdue = false;
        if (hadCheckpointDebt) {
          pushDebtTransition(state, {
            source: "action_signal",
            debt: "pendingCheckpointOverdue",
            action: "clear",
            before: true,
            after: false,
            rule: "checkpoint_overdue",
          });
        }
        const hadResearchDebt = Boolean(state.pendingResearchCapture);
        state.pendingResearchCapture = false;
        if (hadResearchDebt) {
          pushDebtTransition(state, {
            source: "action_signal",
            debt: "pendingResearchCapture",
            action: "clear",
            before: true,
            after: false,
            rule: "research_capture_required",
          });
        }
        state.consecutiveInjections = 0;
        if (law?.custom?.escalation?.resetOnCommit !== false) {
          state.customRuleViolations = {};
          state.customRuleReminderAt = {};
        }
        clearRuleDebt(state, "checkpoint_overdue");
        clearRuleDebt(state, "compaction_checkpoint_required");
        clearRuleDebt(state, "research_capture_required");
        clearRuleDebt(state, "failed_attempt_lookup_required");
        recomputeViolationDebt(state);
      }
      if (isOpenContextContextLookup(commandText)) {
        state.lastContextRecoveryAt = Date.now();
        const hadFailureLookupDebt = Boolean(state.pendingFailureLookup);
        state.pendingFailureLookup = false;
        if (hadFailureLookupDebt) {
          pushDebtTransition(state, {
            source: "action_signal",
            debt: "pendingFailureLookup",
            action: "clear",
            before: true,
            after: false,
            rule: "failed_attempt_lookup_required",
          });
        }
        clearRuleDebt(state, "failed_attempt_lookup_required");
        recomputeViolationDebt(state);
      }
      if (isOpenContextInitCommand(commandText) && isGCCInitialized(directory)) {
        clearRuleDebt(state, "gcc_init_required");
        recomputeViolationDebt(state);
      }

      if (compactionDeterministic && law?.gcc?.compactionCheckpointRequired) {
        const compactionAt = Number(state.lastCompactionAt || 0);
        const commitRecovered = Number(state.lastCommitAt || 0) >= compactionAt && compactionAt > 0;
        const contextRecovered =
          Number(state.lastContextRecoveryAt || 0) >= compactionAt && compactionAt > 0;
        if (state.pendingCompactionCheckpoint && commitRecovered && contextRecovered) {
          state.pendingCompactionCheckpoint = false;
          clearRuleDebt(state, "compaction_checkpoint_required");
          pushDebtTransition(state, {
            source: "action_signal",
            debt: "pendingCompactionCheckpoint",
            action: "clear",
            before: true,
            after: false,
            rule: "compaction_checkpoint_required",
          });
        }
      }

      if (checkpointDeterministic) {
        const shouldOpenCheckpointDebt =
          state.sinceCommitCount >= law.gcc.requireCheckpointEveryTools;
        if (shouldOpenCheckpointDebt && !state.pendingCheckpointOverdue) {
          state.pendingCheckpointOverdue = true;
          pushDebtTransition(state, {
            source: "threshold",
            debt: "pendingCheckpointOverdue",
            action: "open",
            before: false,
            after: true,
            rule: "checkpoint_overdue",
          });
        } else if (!shouldOpenCheckpointDebt && state.pendingCheckpointOverdue) {
          state.pendingCheckpointOverdue = false;
          clearRuleDebt(state, "checkpoint_overdue");
          pushDebtTransition(state, {
            source: "threshold",
            debt: "pendingCheckpointOverdue",
            action: "clear",
            before: true,
            after: false,
            rule: "checkpoint_overdue",
          });
        }
      }
      recomputeViolationDebt(state);

      const historyQuery = buildHistoryQueryFromState(state, [
        commandText,
        safeJsonString(args),
        safeJsonString(toolOutput),
      ]);
      const gccHistory = collectGccHistoryEvidence(directory, historyQuery);

      const researchSignal = detectResearchSignal(tool, args, toolOutput, law);
      if (researchSignal) {
        await log(client, "info", "research source detected", {
          tool,
          sourceType: researchSignal.sourceType,
          urls: researchSignal.urls,
        });
      }
      if (
        law.research.requireCaptureOnDocsOrGithub &&
        shouldEvaluateResearchCapture(tool, commandText, args, toolOutput, researchSignal)
      ) {
        let classifierVerdict = null;
        const fallbackRequireCapture = Boolean(researchSignal);
        let requireCapture = fallbackRequireCapture;
        if (law.research.captureClassifierEnabled) {
          classifierVerdict = await runResearchCaptureClassifier(client, law, {
            tool,
            commandText: clipText(commandText, 900),
            toolArgs: clipText(safeJsonString(args), 900),
            toolOutput: clipText(safeJsonString(toolOutput), 900),
            signal: researchSignal || {
              sourceType: "unknown",
              urls: extractUrls(`${commandText}\n${safeJsonString(args)}\n${safeJsonString(toolOutput)}`).slice(0, 5),
            },
            policyText: law?.research?.capturePolicyText || "",
            debts: {
              pendingResearchCapture: state.pendingResearchCapture,
              sinceCommitCount: state.sinceCommitCount,
            },
            gccHistory,
          });
          if (classifierVerdict.available) {
            requireCapture = classifierVerdict.requireCapture === true;
          } else if (law.research.captureClassifierRequireModelDecision) {
            requireCapture = false;
          }
        } else if (law.research.captureClassifierRequireModelDecision) {
          requireCapture = false;
        }
        await appendLawTrace(client, directory, law, {
          type: "research.capture.classifier",
          sessionId: state.sessionId,
          tool: {
            name: tool,
            commandText: clipText(commandText),
          },
          signal: researchSignal || { sourceType: "unknown", urls: [] },
          classifier: classifierVerdict || {
            available: false,
            source: "fallback_only",
            fallbackRequireCapture,
            requireCapture,
          },
          fallbackRequireCapture,
          requireCapture,
          gccHistory: {
            currentBranch: gccHistory?.currentBranch || "",
            semanticMatches: (gccHistory?.semanticMatches || []).slice(0, 3),
          },
        });
        if (requireCapture) {
          const before = Boolean(state.pendingResearchCapture);
          state.pendingResearchCapture = true;
          if (!before) {
            pushDebtTransition(state, {
              source: "research_classifier",
              debt: "pendingResearchCapture",
              action: "open",
              before: false,
              after: true,
              rule: "research_capture_required",
            });
          }
          recomputeViolationDebt(state);
          const now = Date.now();
          if (now - state.lastResearchReminderTime >= CONFIG.researchReminderCooldownMs) {
            state.lastResearchReminderTime = now;
            const firstUrl = researchSignal?.urls?.[0] || "";
            await toast(client, {
              message: `🔎 Research capture required${firstUrl ? `: ${firstUrl}` : ""}\nCheckpoint with:\nopencontext commit "Research findings on <topic>"`,
              type: "info",
              timeout: 10000,
            });
          }
        }
      }

      if (
        law.gcc.requireFailedAttemptLookup &&
        shouldEvaluateFailureLookup(tool, commandText, toolOutput)
      ) {
        const failureSignal = detectFailureSignal(tool, toolOutput, commandText);
        const fallbackRequireLookup = shouldRequireFailureLookupFallback(
          failureSignal,
          commandText
        );
        let requireLookup = fallbackRequireLookup;
        let classifierVerdict = null;
        if (law.gcc.failureClassifierEnabled) {
          classifierVerdict = await runFailureLookupClassifier(client, law, {
            tool,
            commandText: clipText(commandText, 900),
            toolOutput: failureSignal.excerpt || clipText(safeJsonString(toolOutput), 900),
            failureDetectedBySignal: Boolean(failureSignal.detected),
            failureCategory: failureSignal.category || "none",
            failureReason: failureSignal.reason || "",
            policyText: law?.gcc?.failureLookupPolicyText || "",
            debts: {
              pendingFailureLookup: state.pendingFailureLookup,
              sinceCommitCount: state.sinceCommitCount,
            },
            gccHistory,
          });
          if (classifierVerdict.available) {
            requireLookup = classifierVerdict.requireLookup === true;
          } else if (law.gcc.failureClassifierRequireModelDecision) {
            requireLookup = false;
          }
        } else if (law.gcc.failureClassifierRequireModelDecision) {
          requireLookup = false;
        }
        await appendLawTrace(client, directory, law, {
          type: "failure.lookup.classifier",
          sessionId: state.sessionId,
          tool: {
            name: tool,
            commandText: clipText(commandText),
          },
          signal: {
            detected: Boolean(failureSignal.detected),
            category: failureSignal.category || "none",
            reason: failureSignal.reason || "",
          },
          classifier: classifierVerdict || {
            available: false,
            source: "fallback_only",
            fallbackRequireLookup,
            requireLookup,
          },
          fallbackRequireLookup,
          requireLookup,
          gccHistory: {
            currentBranch: gccHistory?.currentBranch || "",
            semanticMatches: (gccHistory?.semanticMatches || []).slice(0, 3),
          },
        });
        if (requireLookup) {
          const before = Boolean(state.pendingFailureLookup);
          state.pendingFailureLookup = true;
          if (!before) {
            pushDebtTransition(state, {
              source: "failure_classifier",
              debt: "pendingFailureLookup",
              action: "open",
              before: false,
              after: true,
              rule: "failed_attempt_lookup_required",
            });
          }
          recomputeViolationDebt(state);
        }
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
