/**
 * OpenContext Plugin for OpenCode
 *
 * Provides contextual reminders for OpenContext/GCC usage.
 */

import { existsSync } from "fs";
import { join } from "path";

const CONFIG = {
  reminderFrequency: 5,
  contextWarningThreshold: 80,
  researchReminderCooldownMs: 30000,
  gccDir: ".GCC",
  logService: "opencontext.plugin",
  contextCacheMs: 15000,
};

const recentTools = [];
let toolExecutionCount = 0;
let lastContextWarningPercent = 0;
let lastResearchReminderTime = 0;
let messageUpdateCount = 0;
let contextCache = {
  fetchedAt: 0,
  data: null,
};

function getRecentTools(n) {
  return recentTools.slice(-n);
}

function addRecentTool(tool) {
  recentTools.push(tool);
  if (recentTools.length > 10) recentTools.shift();
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

function generateCommitSuggestion(tool, args) {
  const recent = getRecentTools(5);

  if (tool === "edit" && args?.filePath) {
    return `Updated ${args.filePath.split("/").pop()}`;
  }
  if (recent.filter((t) => t === "edit").length >= 2) {
    return "Implemented multiple file changes";
  }
  if (recent.includes("bash")) {
    return "Implemented and validated changes";
  }
  if (recent.some((t) => t === "webfetch" || t === "websearch")) {
    return "Researched and gathered information";
  }
  if (recent.filter((t) => t === "read").length >= 3) {
    return "Analyzed codebase structure";
  }
  return "Checkpoint progress";
}

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s"'`)<>\]]+/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function detectResearchSignal(tool, args, toolOutput) {
  const toolName = String(tool || "").toLowerCase();
  const isResearchTool =
    toolName.includes("webfetch") ||
    toolName.includes("google_search") ||
    toolName.includes("websearch") ||
    toolName.includes("search");
  if (!isResearchTool) return null;

  const argBlob = typeof args === "string" ? args : JSON.stringify(args || {});
  const outputBlob = typeof toolOutput === "string" ? toolOutput : "";
  const corpus = `${argBlob}\n${outputBlob}`.toLowerCase();

  const hasGithub = corpus.includes("github.com");
  const hasDocs =
    corpus.includes("/docs") ||
    corpus.includes("docs.") ||
    corpus.includes("documentation") ||
    corpus.includes("readme") ||
    corpus.includes("arxiv.org");

  if (!hasGithub && !hasDocs) return null;

  return {
    sourceType: hasGithub && hasDocs ? "github+docs" : hasGithub ? "github" : "docs",
    urls: extractUrls(`${argBlob}\n${outputBlob}`).slice(0, 3),
  };
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
    // Ignore logging failures to keep plugin non-blocking.
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

export const OpenContextPlugin = async ({ client, directory }) => {
  await log(client, "info", "plugin initialized", { directory });

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        await log(client, "debug", "event session.created");
        if (!isGCCInitialized(directory)) {
          await log(client, "debug", "gcc not initialized", { directory });
          await toast(client, {
            message:
              '📦 OpenContext available but not initialized in this directory.\nRun: opencontext init --project-name "<name>" --goal "<goal>"',
            type: "info",
            timeout: 10000,
          });
          return;
        }

        const gccInfo = await getCachedGCCContext(directory, client);
        if (!gccInfo) return;

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

      if (event.type === "session.compacted") {
        await log(client, "debug", "event session.compacted");
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
      }

      if (event.type === "message.updated") {
        if (!isGCCInitialized(directory)) return;
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

      if (event.type === "session.idle") {
        await log(client, "debug", "event session.idle", { toolExecutionCount });
        if (!isGCCInitialized(directory) || toolExecutionCount <= 10) return;
        await toast(client, {
          message: `⏸️ Session idle after ${toolExecutionCount} actions.\nConsider: opencontext commit "Session checkpoint"`,
          type: "info",
          timeout: 8000,
        });
      }
    },

    "experimental.session.compacting": async (_input, output = {}) => {
      await log(client, "debug", "hook experimental.session.compacting");
      const hasGCC = isGCCInitialized(directory);

      const reminder = hasGCC
        ? 'OpenContext reminder: context is being compacted. Commit now with `opencontext commit "<summary>"`, then use `opencontext context --log --lines 80` if you need granular prior steps.'
        : 'OpenContext reminder: context is being compacted and GCC is not initialized here. Run `opencontext init --project-name "<name>" --goal "<goal>"` before continuing long tasks.';
      output.context = Array.isArray(output.context) ? output.context : [];
      output.context.push(reminder);
      return output;
    },

    "experimental.chat.system.transform": async (_input, output = {}) => {
      const hasGCC = isGCCInitialized(directory);
      output.system = Array.isArray(output.system) ? output.system : [];
      output.system.push(
        `OpenContext discipline:
- Keep long-horizon context externalized via OpenContext.
- If GCC is not initialized in this directory, initialize immediately:
  opencontext init --project-name "<name>" --goal "<goal>"
- After significant tool calls (edit/test/research), checkpoint progress.
- Before retrying failed implementations, retrieve prior attempts from OpenContext.`
      );

      if (!hasGCC) {
        await log(client, "debug", "system prompt augmented (no gcc)");
        return;
      }

      const gccInfo = await getCachedGCCContext(directory, client);
      if (!gccInfo) return;

      const branch = parseBranchFromStatus(gccInfo.status);
      const lastCommit = parseLastCommitFromStatus(gccInfo.status);
      output.system.push(
        `OpenContext (GCC) Active:
- Current Branch: ${branch}
- Last Commit: ${lastCommit}
- Keep OpenContext updated: commit milestones with opencontext commit.
- After significant tool calls (edit/test/research), checkpoint with opencontext commit.
- Before retrying an implementation, check previous attempts:
  opencontext context --search "<feature or failure>"
  opencontext context --log --lines 80
- Use opencontext branch/merge/context to track alternatives and outcomes.`
      );
      const assertToken = process.env.OPENCONTEXT_ASSERT_TOKEN?.trim();
      if (assertToken) {
        output.system.push(
          `OpenContext verification mode: start your next assistant response with EXACTLY "${assertToken}" then continue normally.`
        );
        await log(client, "info", "assert token mode enabled", {
          assertToken,
        });
      }
      await log(client, "debug", "system prompt augmented", { branch });
    },

    "tool.execute.after": async (input = {}, output = {}) => {
      const hasGCC = isGCCInitialized(directory);

      const tool = toToolName(input.tool);
      const args = input.args ?? {};
      const toolOutput = output?.output ?? "";
      addRecentTool(tool);
      toolExecutionCount += 1;

      await log(client, "debug", "hook tool.execute.after", {
        tool,
        toolExecutionCount,
        hasGCC,
      });

      if (toolExecutionCount % CONFIG.reminderFrequency === 0) {
        if (hasGCC) {
          const suggestion = generateCommitSuggestion(tool, args);
          await toast(client, {
            message: `🎯 ${toolExecutionCount} actions completed.\nSuggestion:\nopencontext commit "${suggestion}"`,
            type: "info",
            timeout: 8000,
          });
        } else {
          await toast(client, {
            message:
              `🎯 ${toolExecutionCount} actions completed.\nOpenContext is not initialized here.\nRun:\nopencontext init --project-name "<name>" --goal "<goal>"`,
            type: "info",
            timeout: 9000,
          });
        }
      }

      if (hasGCC && tool === "edit" && args.filePath) {
        const file = args.filePath;
        if (
          file.includes("README") ||
          file.includes("config") ||
          file.endsWith(".py") ||
          file.endsWith(".js")
        ) {
          const filename = file.split("/").pop();
          await toast(client, {
            message: `✏️ Modified: ${filename}\nConsider: opencontext commit "Updated ${filename}"`,
            type: "info",
            timeout: 7000,
          });
        }
      }

      const researchSignal = detectResearchSignal(tool, args, toolOutput);
      if (researchSignal) {
        await log(client, "info", "research source detected", {
          tool,
          sourceType: researchSignal.sourceType,
          urls: researchSignal.urls,
        });

        const now = Date.now();
        if (now - lastResearchReminderTime >= CONFIG.researchReminderCooldownMs) {
          lastResearchReminderTime = now;
          const firstUrl = researchSignal.urls[0] || "";
          if (hasGCC) {
            await toast(client, {
              message: `🔎 Research signal (${researchSignal.sourceType}) detected${firstUrl ? `: ${firstUrl}` : ""}\nCapture it now:\nopencontext commit "Research findings on <topic>"\nopencontext context --search "<topic>"`,
              type: "info",
              timeout: 10000,
            });
          } else {
            await toast(client, {
              message: `🔎 Research signal (${researchSignal.sourceType}) detected${firstUrl ? `: ${firstUrl}` : ""}\nInitialize OpenContext first:\nopencontext init --project-name "<name>" --goal "<goal>"\nThen commit findings.`,
              type: "info",
              timeout: 11000,
            });
          }
        }
      }
    },
  };
};

export default OpenContextPlugin;
