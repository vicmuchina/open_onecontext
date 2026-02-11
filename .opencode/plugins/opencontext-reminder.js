/**
 * OpenContext Plugin for OpenCode
 * 
 * Provides gentle, contextual reminders to use GCC commands
 * Based on the Git Context Controller (GCC) paper
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Configuration
const CONFIG = {
  reminderFrequency: 5,  // Every N tool executions
  contextWarningThreshold: 80,  // Percentage
  gccDir: ".GCC",
};

// State tracking
let toolExecutionCount = 0;
let lastReminderTime = 0;

/**
 * Generate a commit suggestion based on recent tool usage
 */
function generateCommitSuggestion(tool, input, output) {
  const recentTools = getRecentTools(5);
  
  // Check for file edits
  if (tool === "edit" && input.filePath) {
    return `Updated ${input.filePath.split('/').pop()}`;
  }
  
  // Check for multiple file operations
  if (recentTools.filter(t => t === "edit").length >= 2) {
    return "Implemented multiple file changes";
  }
  
  // Check for bash + test pattern
  if (recentTools.includes("bash") && recentTools.includes("bash")) {
    return "Implemented and validated changes";
  }
  
  // Check for research pattern
  if (recentTools.filter(t => t === "webfetch" || t === "websearch").length > 0) {
    return "Researched and gathered information";
  }
  
  // Check for read-heavy pattern (understanding code)
  if (recentTools.filter(t => t === "read").length >= 3) {
    return "Analyzed codebase structure";
  }
  
  return "Checkpoint progress";
}

// Track recent tools
const recentTools = [];

function getRecentTools(n) {
  return recentTools.slice(-n);
}

function addRecentTool(tool) {
  recentTools.push(tool);
  if (recentTools.length > 10) {
    recentTools.shift();
  }
}

/**
 * Check if GCC is initialized in the project
 */
function isGCCInitialized(directory) {
  return existsSync(join(directory, CONFIG.gccDir));
}

/**
 * Get GCC context for injection
 */
async function getGCCContext(directory) {
  try {
    const { execSync } = await import("child_process");
    const context = execSync("opencontext context", { 
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000 
    });
    
    const status = execSync("opencontext status", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000
    });
    
    return { context, status };
  } catch (e) {
    return null;
  }
}

/**
 * Main plugin export
 */
export const OpenContextPlugin = async ({ project, client, directory }) => {
  console.log("[OpenContext] Plugin initialized");
  
  return {
    /**
     * Auto-discover and inject GCC context on session start
     */
    "session.created": async () => {
      if (!isGCCInitialized(directory)) {
        console.log("[OpenContext] GCC not initialized in this project");
        return {};
      }
      
      console.log("[OpenContext] GCC detected, loading context...");
      
      const gccInfo = await getGCCContext(directory);
      if (!gccInfo) {
        return {};
      }
      
      // Parse current branch from status
      const branchMatch = gccInfo.status.match(/Current branch: (\w+)/);
      const branch = branchMatch ? branchMatch[1] : "unknown";
      
      // Parse last commit
      const commitMatch = gccInfo.status.match(/Last commit: (.+)/);
      const lastCommit = commitMatch ? commitMatch[1] : "none";
      
      // Show notification
      await client.app.toast({
        message: `📦 GCC Context Loaded\nBranch: ${branch}\nLast: ${lastCommit.substring(0, 40)}...`,
        type: "info",
        timeout: 8000
      });
      
      // Inject context into system prompt
      return {
        context: `## 📦 OpenContext (GCC) Active
Current Branch: ${branch}
Last Commit: ${lastCommit}

💡 Available commands:
• opencontext commit "<summary>" - Checkpoint progress
• opencontext branch "<name>" - Explore alternative
• opencontext merge "<branch>" - Integrate results
• opencontext context - View project status
• opencontext tui - Launch dashboard

📊 Context automatically tracked. Commit at milestones!`
      };
    },
    
    /**
     * Critical: Warn when context is compacted
     */
    "session.compacted": async (input, output) => {
      if (!isGCCInitialized(directory)) return;
      
      console.log("[OpenContext] Context compaction detected!");
      
      await client.app.toast({
        message: `⚠️ Context Compacted!\nImportant details may be lost.\n\n💡 Run: opencontext commit "<what was achieved>"`,
        type: "warning",
        timeout: 15000
      });
      
      // Also add to context
      output.context = output.context || [];
      output.context.push(`⚠️ CONTEXT WAS COMPACTED! Consider committing recent progress with: opencontext commit "summary"`);
    },
    
    /**
     * Milestone reminder every N tool executions
     */
    "tool.execute.after": async (input, output) => {
      if (!isGCCInitialized(directory)) return;
      
      const tool = input.tool;
      addRecentTool(tool);
      toolExecutionCount++;
      
      // Remind every N tool executions
      if (toolExecutionCount % CONFIG.reminderFrequency === 0) {
        const suggestion = generateCommitSuggestion(tool, input.args, output);
        
        await client.app.toast({
          message: `🎯 Milestone Reached!\n${toolExecutionCount} actions completed.\n\n💡 Suggestion:\nopencontext commit "${suggestion}"`,
          type: "info",
          timeout: 10000
        });
      }
      
      // Special reminders for significant actions
      if (tool === "edit" && input.args?.filePath) {
        const file = input.args.filePath;
        // Remind after editing important files
        if (file.includes("README") || file.includes("config") || file.endsWith(".py") || file.endsWith(".js")) {
          await client.app.toast({
            message: `✏️ Modified: ${file.split('/').pop()}\n💡 Consider: opencontext commit "Updated ${file.split('/').pop()}"`,
            type: "info",
            timeout: 8000
          });
        }
      }
    },
    
    /**
     * Context usage statistics
     */
    "message.updated": async (input) => {
      if (!isGCCInitialized(directory)) return;
      
      // Calculate rough context usage (this is approximate)
      const messageCount = input.messages?.length || 0;
      const contextPercent = Math.min(100, Math.round((messageCount / 50) * 100));
      
      if (contextPercent > CONFIG.contextWarningThreshold && contextPercent % 10 === 0) {
        await client.app.toast({
          message: `📊 Context Usage: ${contextPercent}%\nConsider committing to preserve progress.\n\n💡 opencontext commit "<summary>"`,
          type: "info",
          timeout: 8000
        });
      }
    },
    
    /**
     * Session idle reminder
     */
    "session.idle": async () => {
      if (!isGCCInitialized(directory)) return;
      
      if (toolExecutionCount > 10) {
        await client.app.toast({
          message: `⏸️ Session Idle\n${toolExecutionCount} actions this session.\n\n💡 Finalize with:\nopencontext commit "Session checkpoint"`,
          type: "info",
          timeout: 10000
        });
      }
    },
    
    /**
     * Log session completion
     */
    "session.completed": async () => {
      if (!isGCCInitialized(directory)) return;
      
      console.log(`[OpenContext] Session completed. ${toolExecutionCount} tool executions.`);
      
      if (toolExecutionCount > 5) {
        await client.app.toast({
          message: `✅ Session Complete!\n${toolExecutionCount} actions performed.\n\n💡 Don't forget to commit!`,
          type: "info",
          timeout: 10000
        });
      }
    }
  };
};

export default OpenContextPlugin;
