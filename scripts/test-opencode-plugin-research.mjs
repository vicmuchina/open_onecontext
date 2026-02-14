import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const pluginFile = join(rootDir, "opencontext", "opencontext", "plugin", "opencontext-reminder.js");

const tempDir = mkdtempSync(join(tmpdir(), "ocx-plugin-research-"));
mkdirSync(join(tempDir, ".GCC"), { recursive: true });

const logEntries = [];
const toasts = [];
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
};

try {
  const pluginModule = await import(pathToFileURL(pluginFile).href);
  const OpenContextPlugin = pluginModule.default;
  const hooks = await OpenContextPlugin({ client, directory: tempDir });

  await hooks["tool.execute.after"](
    {
      tool: "webfetch",
      args: {
        url: "https://github.com/vercel/next.js",
      },
    },
    {
      output: "Found docs at https://nextjs.org/docs and implementation details on GitHub.",
    }
  );

  const hasResearchLog = logEntries.some((entry) => entry?.message === "research source detected");
  const hasResearchToast = toasts.some((entry) =>
    String(entry?.message || "").includes("Research signal")
  );

  if (!hasResearchLog) {
    console.error("FAIL  research log was not emitted");
    process.exit(1);
  }
  if (!hasResearchToast) {
    console.error("FAIL  research reminder toast was not emitted");
    process.exit(1);
  }

  console.log("PASS  research-source reminder path");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
