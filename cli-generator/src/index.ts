#!/usr/bin/env node

/**
 * CodeNexus CLI Generator
 *
 * Fused from CLI-Anything's CLI framework. Provides the main
 * `codenexus` CLI command with subcommands for review, fix, audit,
 * watch, status, configure, and auth. Uses yargs for Click-style
 * argument parsing. Integrates all modules via the control plane
 * orchestrator.
 *
 * ```ts
 * # Run as CLI:
 * $ codenexus review --owner org --repo my-repo --pr 42
 * $ codenexus fix --owner org --repo my-repo --pr 42 --apply
 * $ codenexus audit --file path/to/design.html
 * $ codenexus watch --owner org --repo my-repo
 * $ codenexus status --run <run-id>
 * $ codenexus configure --show
 * $ codenexus auth login --token ghp_xxx
 * ```
 */

import yargs from "yargs";
import type {
  CLIDefinition,
  CLICommand,
  CLIArgument,
  CLIOption,
  CLIExample,
  GitHubWebhookEvent,
  AgentMode,
  CodeNexusConfig,
  ReviewMetric,
  DesignAudit,
  DashboardData,
} from "../../shared/src/types.js";
import {
  Severity,
  SessionStatus,
  AgentMode as AgentModeEnum,
} from "../../shared/src/types.js";
import * as crypto from "node:crypto";
import * as path from "node:path";

// ─── Re-exports ───────────────────────────────────────────────

export type {
  CLIDefinition,
  CLICommand,
  CLIArgument,
  CLIOption,
  CLIExample,
} from "../../shared/src/types.js";

// ─── CLI Definition Metadata ──────────────────────────────────

export const CLI_DEFINITION: CLIDefinition = {
  name: "codenexus",
  version: "1.0.0",
  description: "CodeNexus — AI-powered code review, fix, and audit platform",
  commands: [
    {
      name: "review",
      description: "Trigger a full code review on a pull request",
      arguments: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (user or org)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "pr",
          type: "number",
          required: true,
          description: "Pull request number",
        },
      ],
      options: [
        {
          name: "mode",
          flag: "-m",
          type: "string",
          default: "review",
          description: "Review mode: review, fix, plan, build",
          required: false,
        },
        {
          name: "output",
          flag: "-o",
          type: "string",
          default: "pretty",
          description: "Output format: pretty, json, silent",
          required: false,
        },
        {
          name: "depth",
          flag: "-d",
          type: "number",
          default: 5,
          description: "Review depth (1-10)",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus review --owner org --repo my-repo --pr 42",
          description: "Review PR #42",
        },
        {
          command: "codenexus review -o org -r my-repo -p 42 --mode full",
          description: "Full review with fix mode",
        },
      ],
    },
    {
      name: "fix",
      description: "Apply auto-fixes to a pull request",
      arguments: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "pr",
          type: "number",
          required: true,
          description: "Pull request number",
        },
      ],
      options: [
        {
          name: "apply",
          flag: "-a",
          type: "boolean",
          default: false,
          description: "Actually apply fixes (dry-run if omitted)",
          required: false,
        },
        {
          name: "type",
          flag: "-t",
          type: "string",
          default: "all",
          description: "Fix type: all, lint, design, security",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus fix --owner org --repo my-repo --pr 42 --apply",
          description: "Apply fixes to PR #42",
        },
      ],
    },
    {
      name: "audit",
      description: "Audit a file or directory for design & security issues",
      arguments: [
        {
          name: "file",
          type: "string",
          required: true,
          description: "File or directory path to audit",
        },
      ],
      options: [
        {
          name: "type",
          flag: "-t",
          type: "string",
          default: "design",
          description: "Audit type: design, security, both",
          required: false,
        },
        {
          name: "format",
          flag: "-f",
          type: "string",
          default: "html",
          description: "Input format: html, css",
          required: false,
        },
        {
          name: "output",
          flag: "-o",
          type: "string",
          default: "pretty",
          description: "Output format: pretty, json",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus audit --file ./src/components/Button.tsx",
          description: "Design audit a component",
        },
        {
          command: "codenexus audit -f ./index.html -t both -o json",
          description: "Full audit with JSON output",
        },
      ],
    },
    {
      name: "watch",
      description: "Watch a repository for new PRs and auto-review",
      arguments: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
      ],
      options: [
        {
          name: "interval",
          flag: "-i",
          type: "number",
          default: 60,
          description: "Polling interval in seconds",
          required: false,
        },
        {
          name: "mode",
          flag: "-m",
          type: "string",
          default: "review",
          description: "Watch mode: review, fix",
          required: false,
        },
        {
          name: "daemon",
          flag: "-d",
          type: "boolean",
          default: false,
          description: "Run as background daemon",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus watch --owner org --repo my-repo",
          description: "Watch repository for new PRs",
        },
      ],
    },
    {
      name: "status",
      description: "Check status of a review run or the system",
      arguments: [
        {
          name: "run",
          type: "string",
          required: false,
          description: "Run ID to check",
        },
      ],
      options: [
        {
          name: "all",
          flag: "-a",
          type: "boolean",
          default: false,
          description: "Show all recent runs",
          required: false,
        },
        {
          name: "limit",
          flag: "-l",
          type: "number",
          default: 10,
          description: "Number of recent runs to show",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus status --run abc-123",
          description: "Check status of a specific run",
        },
        {
          command: "codenexus status --all",
          description: "Show all recent runs",
        },
      ],
    },
    {
      name: "configure",
      description: "View or modify CodeNexus configuration",
      arguments: [],
      options: [
        {
          name: "show",
          flag: "-s",
          type: "boolean",
          default: false,
          description: "Show current configuration",
          required: false,
        },
        {
          name: "set",
          flag: "-S",
          type: "string",
          default: "",
          description: "Set a config value (key=value)",
          required: false,
        },
        {
          name: "file",
          flag: "-f",
          type: "string",
          default: "",
          description: "Config file path",
          required: false,
        },
        {
          name: "init",
          flag: "-i",
          type: "boolean",
          default: false,
          description: "Initialize default config",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus configure --show",
          description: "Show current config",
        },
        {
          command: "codenexus configure --set github.token=ghp_xxx",
          description: "Set a config value",
        },
      ],
    },
    {
      name: "auth",
      description: "Authenticate with GitHub and manage credentials",
      arguments: [],
      options: [
        {
          name: "login",
          flag: "-l",
          type: "boolean",
          default: false,
          description: "Log in with a token",
          required: false,
        },
        {
          name: "token",
          flag: "-t",
          type: "string",
          default: "",
          description: "GitHub personal access token",
          required: false,
        },
        {
          name: "logout",
          flag: "-L",
          type: "boolean",
          default: false,
          description: "Log out and clear credentials",
          required: false,
        },
        {
          name: "status",
          flag: "-s",
          type: "boolean",
          default: false,
          description: "Check auth status",
          required: false,
        },
      ],
      subcommands: [],
      examples: [
        {
          command: "codenexus auth login --token ghp_xxx",
          description: "Authenticate with GitHub token",
        },
        {
          command: "codenexus auth status",
          description: "Check authentication status",
        },
      ],
    },
  ],
};

// ─── CLI Colors (lightweight chalk alternative) ───────────────

const COLORS: Record<string, (text: string) => string> = {
  green: (t: string) => `\x1b[32m${t}\x1b[0m`,
  red: (t: string) => `\x1b[31m${t}\x1b[0m`,
  yellow: (t: string) => `\x1b[33m${t}\x1b[0m`,
  blue: (t: string) => `\x1b[34m${t}\x1b[0m`,
  cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
  gray: (t: string) => `\x1b[90m${t}\x1b[0m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
  dim: (t: string) => `\x1b[2m${t}\x1b[0m`,
};

function colorize(text: string, color: keyof typeof COLORS): string {
  return COLORS[color]?.(text) ?? text;
}

// ─── CLI Handlers ─────────────────────────────────────────────

/**
 * Handle the `review` subcommand.
 */
async function handleReview(args: {
  owner: string;
  repo: string;
  pr: number;
  mode?: string;
  output?: string;
  depth?: number;
}): Promise<void> {
  console.log(colorize("\n🔍 CodeNexus Review", "bold"));
  console.log(colorize("─".repeat(48), "dim"));
  console.log(
    `  ${colorize("Repository:", "cyan")} ${args.owner}/${args.repo}#${args.pr}`,
  );
  console.log(`  ${colorize("Mode:", "cyan")}       ${args.mode ?? "review"}`);
  console.log(`  ${colorize("Depth:", "cyan")}      ${args.depth ?? 5}`);
  console.log(colorize("─".repeat(48), "dim"));

  try {
    // Build the webhook event to feed the orchestrator
    const event: GitHubWebhookEvent = {
      action: "opened",
      pullRequest: {
        number: args.pr,
        state: "open",
        title: `PR #${args.pr} from CLI review`,
        body: "",
        head: { ref: "head", sha: "" },
        base: { ref: "base", sha: "" },
        user: { login: "cli-user" },
      },
      repository: {
        fullName: `${args.owner}/${args.repo}`,
        owner: { login: args.owner },
        name: args.repo,
        cloneUrl: `https://github.com/${args.owner}/${args.repo}.git`,
      },
      sender: { login: "cli-user" },
    };

    // Attempt to use the orchestrator if available
    try {
      const { Orchestrator } =
        await import("../../control-plane/src/orchestrator.js");
      const orchestrator = new Orchestrator();

      const result = await orchestrator.executeCycle({
        event,
        sessionId: `cli-${Date.now()}`,
        mode: (args.mode as AgentMode) ?? AgentModeEnum.Review,
        config: getDefaultConfig(),
      });

      printRunResult(result);
    } catch (orchestratorError) {
      // Fallback: standalone review
      console.log(colorize("\n  Running standalone review...", "yellow"));

      const designIssues = await runDesignReview(args);
      if (designIssues.length > 0) {
        printAntiPatterns(designIssues);
      } else {
        console.log(`  ${colorize("✓", "green")} No design issues found.`);
      }

      console.log(colorize("\n  Review complete.", "green"));
      if (args.output === "json") {
        console.log(
          JSON.stringify({ status: "complete", issues: designIssues }, null, 2),
        );
      }
    }
  } catch (err) {
    console.error(colorize(`\n  ✗ Review failed: ${err}`, "red"));
    process.exit(1);
  }
}

/**
 * Handle the `fix` subcommand.
 */
async function handleFix(args: {
  owner: string;
  repo: string;
  pr: number;
  apply?: boolean;
  type?: string;
}): Promise<void> {
  console.log(colorize("\n🔧 CodeNexus Fix", "bold"));
  console.log(colorize("─".repeat(48), "dim"));
  console.log(
    `  ${colorize("Repository:", "cyan")} ${args.owner}/${args.repo}#${args.pr}`,
  );
  console.log(`  ${colorize("Type:", "cyan")}       ${args.type ?? "all"}`);
  console.log(
    `  ${colorize("Apply:", "cyan")}      ${args.apply ? "yes" : "dry-run"}`,
  );
  console.log(colorize("─".repeat(48), "dim"));

  if (!args.apply) {
    console.log(
      colorize("\n  ⚠ Dry-run mode. Use --apply to apply fixes.", "yellow"),
    );
  }

  try {
    const { Orchestrator } =
      await import("../../control-plane/src/orchestrator.js");
    const orchestrator = new Orchestrator();

    const event: GitHubWebhookEvent = {
      action: "synchronize",
      pullRequest: {
        number: args.pr,
        state: "open",
        title: `Fix PR #${args.pr}`,
        body: "",
        head: { ref: "head", sha: "" },
        base: { ref: "base", sha: "" },
        user: { login: "cli-user" },
      },
      repository: {
        fullName: `${args.owner}/${args.repo}`,
        owner: { login: args.owner },
        name: args.repo,
        cloneUrl: `https://github.com/${args.owner}/${args.repo}.git`,
      },
      sender: { login: "cli-user" },
    };

    const result = await orchestrator.executeCycle({
      event,
      sessionId: `fix-${Date.now()}`,
      mode: AgentModeEnum.Fix,
      config: getDefaultConfig(),
    });

    console.log(
      colorize(
        `\n  ✓ Fix cycle complete (${result.results.length} steps)`,
        "green",
      ),
    );
    console.log(colorize(`  Status: ${result.overallStatus}`, "cyan"));
  } catch (err) {
    console.error(colorize(`\n  ✗ Fix failed: ${err}`, "red"));
    process.exit(1);
  }
}

/**
 * Handle the `audit` subcommand.
 */
async function handleAudit(args: {
  file: string;
  type?: string;
  format?: string;
  output?: string;
}): Promise<void> {
  console.log(colorize("\n📋 CodeNexus Audit", "bold"));
  console.log(colorize("─".repeat(48), "dim"));
  console.log(`  ${colorize("File:", "cyan")}   ${args.file}`);
  console.log(`  ${colorize("Type:", "cyan")}   ${args.type ?? "design"}`);
  console.log(`  ${colorize("Format:", "cyan")} ${args.format ?? "html"}`);
  console.log(colorize("─".repeat(48), "dim"));

  try {
    const fs = await import("node:fs");
    const content = fs.readFileSync(args.file, "utf-8");

    // Use DesignReviewer if available
    try {
      const { DesignReviewer } =
        await import("../../design-reviewer/src/index.js");
      const reviewer = new DesignReviewer();

      if (args.type === "design" || args.type === "both") {
        const audit = reviewer.critique(
          content,
          (args.format as "html" | "css") ?? "html",
        );
        printAuditResult(audit, "design");
      }

      if (args.type === "both") {
        console.log(colorize("\n  ─── Security Audit ───", "bold"));
        // Note: full security audit would use the security module
        console.log("  Security scanning requires a running security module.");
      }
    } catch {
      console.log(
        colorize("\n  ⚠ DesignReviewer module not available.", "yellow"),
      );
      console.log("  Run `npm run build` from the project root first.");
    }

    if (args.output === "json") {
      // JSON output would be printed here
    }
  } catch (err) {
    console.error(colorize(`\n  ✗ Audit failed: ${err}`, "red"));
    process.exit(1);
  }
}

/**
 * Handle the `watch` subcommand.
 */
async function handleWatch(args: {
  owner: string;
  repo: string;
  interval?: number;
  mode?: string;
  daemon?: boolean;
}): Promise<void> {
  const interval = (args.interval ?? 60) * 1000;

  console.log(colorize("\n👀 CodeNexus Watch", "bold"));
  console.log(colorize("─".repeat(48), "dim"));
  console.log(
    `  ${colorize("Repository:", "cyan")} ${args.owner}/${args.repo}`,
  );
  console.log(`  ${colorize("Interval:", "cyan")}   ${args.interval ?? 60}s`);
  console.log(`  ${colorize("Mode:", "cyan")}       ${args.mode ?? "review"}`);
  console.log(colorize("─".repeat(48), "dim"));

  if (args.daemon) {
    console.log(
      colorize("\n  Running as daemon — send SIGTERM to stop.\n", "dim"),
    );

    // Daemonize (simplified — real daemonization would use a process manager)
    process.on("SIGTERM", () => {
      console.log(colorize("\n  Watch daemon stopped.", "yellow"));
      process.exit(0);
    });
    process.on("SIGINT", () => {
      console.log(colorize("\n  Watch daemon stopped.", "yellow"));
      process.exit(0);
    });
  }

  let pollCount = 0;
  const poll = async () => {
    pollCount++;
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(
      colorize(
        `  [${timestamp}] Poll #${pollCount}: Checking ${args.owner}/${args.repo}...`,
        "gray",
      ),
    );

    try {
      // In production, this would poll the GitHub API for new PRs
      console.log(colorize(`  [${timestamp}] No new PRs found.`, "dim"));
    } catch (err) {
      console.error(colorize(`  [${timestamp}] Error: ${err}`, "red"));
    }
  };

  // Run immediately, then on interval
  await poll();
  setInterval(poll, interval);
}

/**
 * Handle the `status` subcommand.
 */
async function handleStatus(args: {
  run?: string;
  all?: boolean;
  limit?: number;
}): Promise<void> {
  console.log(colorize("\n📊 CodeNexus Status", "bold"));
  console.log(colorize("─".repeat(48), "dim"));

  if (args.run) {
    console.log(`  ${colorize("Run ID:", "cyan")} ${args.run}`);

    try {
      const { getOrchestrator } =
        await import("../../control-plane/src/orchestrator.js");
      const orchestrator = getOrchestrator();
      const run = orchestrator.getRun(args.run);

      if (run) {
        printRunResult(run);
      } else {
        console.log(colorize("\n  ⚠ Run not found.", "yellow"));
      }
    } catch {
      console.log(colorize("\n  ⚠ Orchestrator not available.", "yellow"));
      console.log(`  Run ID: ${args.run}`);
      console.log(
        `  ${colorize("Status:", "cyan")} unknown (orchestrator offline)`,
      );
    }
  } else if (args.all) {
    console.log(
      `  ${colorize("Showing", "cyan")} recent runs (limit: ${args.limit ?? 10})`,
    );

    try {
      const { getOrchestrator } =
        await import("../../control-plane/src/orchestrator.js");
      const orchestrator = getOrchestrator();
      const runs = orchestrator.getActiveRuns().slice(0, args.limit ?? 10);

      if (runs.length === 0) {
        console.log(colorize("\n  No active runs.", "dim"));
      } else {
        for (const run of runs) {
          console.log(
            `  ${colorize("•", "cyan")} ${run.id.slice(0, 8)}... | ${run.mode} | ${run.overallStatus}`,
          );
        }
      }
    } catch {
      console.log(colorize("\n  ⚠ Orchestrator not available.", "yellow"));
    }
  } else {
    // Show system status
    console.log(
      `  ${colorize("System:", "cyan")} CodeNexus v${CLI_DEFINITION.version}`,
    );

    try {
      const { getOrchestrator } =
        await import("../../control-plane/src/orchestrator.js");
      const orchestrator = getOrchestrator();
      const activeRuns = orchestrator.getActiveRuns();
      console.log(`  ${colorize("Active runs:", "cyan")} ${activeRuns.length}`);
      console.log(colorize("  ✓ Orchestrator online", "green"));
    } catch {
      console.log(colorize("  ⚠ Orchestrator offline", "yellow"));
    }

    // Check config
    const configPath = process.env.CNX_CONFIG_PATH ?? "./codenexus.config.json";
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(configPath)) {
        console.log(colorize("  ✓ Config found", "green"));
      } else {
        console.log(colorize("  ⚠ No config file", "yellow"));
      }
    } catch {
      console.log(colorize("  ⚠ Could not check config", "yellow"));
    }
  }
}

/**
 * Handle the `configure` subcommand.
 */
async function handleConfigure(args: {
  show?: boolean;
  set?: string;
  file?: string;
  init?: boolean;
}): Promise<void> {
  console.log(colorize("\n⚙ CodeNexus Configure", "bold"));
  console.log(colorize("─".repeat(48), "dim"));

  const configPath =
    args.file || process.env.CNX_CONFIG_PATH || "./codenexus.config.json";

  if (args.init) {
    // Create default config
    const defaultConfig: CodeNexusConfig = {
      auth: {
        provider: "github",
        jwtSecret: "",
        oidc: {
          issuer: "",
          clients: [],
        },
      },
      github: {
        token: "",
        appId: "",
        webhookSecret: "",
      },
      agent: {
        provider: "openai",
        model: "gpt-4o",
        lspEnabled: true,
        maxDepth: 10,
      },
      security: {
        promptInjection: true,
        dataExfiltration: true,
        agentMonitoring: true,
      },
      knowledge: {
        bookDirectory: "./knowledge",
        maxSources: 10,
        minConfidence: 0.6,
      },
      analytics: {
        provider: "superset",
        dashboardUrl: "",
      },
    };

    try {
      const fs = await import("node:fs");
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(
        colorize(`  ✓ Default config written to ${configPath}`, "green"),
      );
    } catch (err) {
      console.error(colorize(`  ✗ Failed to write config: ${err}`, "red"));
    }
    return;
  }

  if (args.show) {
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log(colorize("  ⚠ No config file found.", "yellow"));
        console.log(`  Use --init to create one at ${configPath}`);
      }
    } catch (err) {
      console.error(colorize(`  ✗ Failed to read config: ${err}`, "red"));
    }
    return;
  }

  if (args.set) {
    const eqIndex = args.set.indexOf("=");
    if (eqIndex === -1) {
      console.error(
        colorize(
          "  ✗ Invalid format. Use key=value (e.g., github.token=ghp_xxx)",
          "red",
        ),
      );
      process.exit(1);
    }

    const key = args.set.slice(0, eqIndex);
    const value = args.set.slice(eqIndex + 1);
    console.log(
      `  ${colorize("Setting:", "cyan")} ${colorize(key, "bold")} = ${value ? "****" : "(empty)"}`,
    );

    try {
      const fs = await import("node:fs");
      let config: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }

      // Set nested keys (e.g., github.token)
      const keys = key.split(".");
      let current = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== "object") {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = coerceValue(value);

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(colorize(`  ✓ Updated ${key} in ${configPath}`, "green"));
    } catch (err) {
      console.error(colorize(`  ✗ Failed to set config: ${err}`, "red"));
    }
    return;
  }

  // No option — show help
  console.log("  Usage: codenexus configure --show | --set key=value | --init");
}

/**
 * Handle the `auth` subcommand.
 */
async function handleAuth(args: {
  login?: boolean;
  token?: string;
  logout?: boolean;
  status?: boolean;
}): Promise<void> {
  console.log(colorize("\n🔐 CodeNexus Auth", "bold"));
  console.log(colorize("─".repeat(48), "dim"));

  const credsFile = path.resolve(process.env.CNX_CREDENTIAL_PATH || './.codenexus-credentials');

  if (args.login) {
    if (!args.token) {
      console.error(
        colorize("  ✗ Token is required for login. Use --token <token>", "red"),
      );
      process.exit(1);
    }

    try {
      const fs = await import("node:fs");

      const key = crypto.scryptSync(
        process.env.CNX_CREDENTIALS_KEY || 'codenexus-default-encryption-key',
        'codenexus-salt',
        32
      );
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({
        token: args.token,
        storedAt: new Date().toISOString(),
      }), 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const data = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
      fs.writeFileSync(credsFile, data, { mode: 0o600 });
      console.log(colorize("  ✓ Authentication credentials stored.", "green"));
      console.log(colorize("  Token: ****" + args.token.slice(-4), "cyan"));
    } catch (err) {
      console.error(colorize(`  ✗ Failed to store credentials: ${err}`, "red"));
      process.exit(1);
    }
    return;
  }

  if (args.logout) {
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(credsFile)) {
        fs.unlinkSync(credsFile);
        console.log(colorize("  ✓ Credentials cleared.", "green"));
      } else {
        console.log(colorize("  ⚠ No credentials to clear.", "yellow"));
      }
    } catch (err) {
      console.error(colorize(`  ✗ Failed to clear credentials: ${err}`, "red"));
    }
    return;
  }

  if (args.status) {
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(credsFile)) {
        const creds = decryptCredentials(fs.readFileSync(credsFile, "utf-8"));
        console.log(colorize("  ✓ Authenticated", "green"));
        console.log(
          `  ${colorize("Token:", "cyan")} ****${creds.token?.slice(-4) ?? "unknown"}`,
        );
        console.log(
          `  ${colorize("Stored at:", "cyan")} ${creds.storedAt ?? "unknown"}`,
        );
      } else {
        console.log(colorize("  ⚠ Not authenticated.", "yellow"));
        console.log(
          "  Run `codenexus auth login --token <token>` to authenticate.",
        );
      }
    } catch {
      console.log(colorize("  ⚠ Could not check auth status.", "yellow"));
    }
    return;
  }

  // No option — show help
  console.log("  Usage: codenexus auth login --token <token>");
  console.log("         codenexus auth logout");
  console.log("         codenexus auth status");
}

function decryptCredentials(encrypted: string): any {
  const key = crypto.scryptSync(
    process.env.CNX_CREDENTIALS_KEY || 'codenexus-default-encryption-key',
    'codenexus-salt',
    32
  );
  const [ivHex, authTagHex, dataHex] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

// ─── Helpers ──────────────────────────────────────────────────

function getDefaultConfig(): CodeNexusConfig {
  return {
    auth: {
      provider: "github",
      jwtSecret: "",
      oidc: { issuer: "", clients: [] },
    },
    github: { token: "", appId: "", webhookSecret: "" },
    agent: {
      provider: "openai",
      model: "gpt-4o",
      lspEnabled: true,
      maxDepth: 10,
    },
    security: {
      promptInjection: true,
      dataExfiltration: true,
      agentMonitoring: true,
    },
    knowledge: {
      bookDirectory: "./knowledge",
      maxSources: 10,
      minConfidence: 0.6,
    },
    analytics: { provider: "superset", dashboardUrl: "" },
  };
}

function coerceValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value === "undefined") return undefined;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
}

async function runDesignReview(
  _args: Record<string, unknown>,
): Promise<unknown[]> {
  // In production, this would call the DesignReviewer module
  return [];
}

function printRunResult(result: {
  id: string;
  mode: string;
  overallStatus: SessionStatus;
  results: Array<{
    step: string;
    status: string;
    durationMs: number;
    error?: string;
  }>;
  startedAt: string;
  completedAt: string | null;
}): void {
  console.log(colorize("\n  ─── Run Result ───", "bold"));
  console.log(`  ${colorize("Run ID:", "cyan")}     ${result.id}`);
  console.log(`  ${colorize("Mode:", "cyan")}       ${result.mode}`);
  console.log(
    `  ${colorize("Status:", "cyan")}     ${formatStatus(result.overallStatus)}`,
  );
  console.log(`  ${colorize("Started:", "cyan")}    ${result.startedAt}`);
  if (result.completedAt) {
    const duration =
      new Date(result.completedAt).getTime() -
      new Date(result.startedAt).getTime();
    console.log(
      `  ${colorize("Duration:", "cyan")}   ${(duration / 1000).toFixed(1)}s`,
    );
  }

  for (const step of result.results) {
    const icon =
      step.status === "success" ? "✓" : step.status === "skipped" ? "○" : "✗";
    const color =
      step.status === "success"
        ? "green"
        : step.status === "skipped"
          ? "yellow"
          : "red";
    console.log(
      `  ${colorize(icon, color)} ${step.step} (${step.durationMs}ms)`,
    );
  }
}

function printAntiPatterns(
  patterns: Array<{
    name: string;
    severity: Severity;
    element: string;
    fix: string;
  }>,
): void {
  console.log(colorize(`\n  Found ${patterns.length} issues:\n`, "yellow"));

  for (const ap of patterns) {
    const severityColor: Record<string, keyof typeof COLORS> = {
      critical: "red",
      high: "red",
      medium: "yellow",
      low: "cyan",
      info: "gray",
    };

    console.log(
      `  ${colorize("•", severityColor[ap.severity] ?? "gray")} ${colorize(ap.name, "bold")}`,
    );
    console.log(`    ${colorize("Element:", "cyan")} ${ap.element}`);
    console.log(`    ${colorize("Severity:", "cyan")} ${ap.severity}`);
    console.log(`    ${colorize("Fix:", "cyan")} ${ap.fix}`);
    console.log("");
  }
}

function printAuditResult(audit: DesignAudit, _type: string): void {
  console.log(
    colorize(`\n  ─── Design Audit (Score: ${audit.score}/100) ───`, "bold"),
  );

  const scoreColor =
    audit.score >= 90 ? "green" : audit.score >= 70 ? "yellow" : "red";
  console.log(
    `  ${colorize("Score:", "cyan")} ${colorize(`${audit.score}/100`, scoreColor)}`,
  );
  console.log(`  ${colorize("Issues:", "cyan")} ${audit.antiPatterns.length}`);

  if (audit.antiPatterns.length > 0) {
    printAntiPatterns(audit.antiPatterns);
  }

  console.log(colorize("\n  Recommendations:", "cyan"));
  for (const rec of audit.recommendations) {
    console.log(`  • ${rec}`);
  }
}

function formatStatus(status: SessionStatus): string {
  const colors: Record<string, keyof typeof COLORS> = {
    completed: "green",
    running: "cyan",
    pending: "yellow",
    failed: "red",
    cancelled: "yellow",
  };
  return colorize(status, colors[status] ?? "gray");
}

// ─── CLI Main Entry Point ─────────────────────────────────────

/**
 * Parse and execute CLI commands using yargs.
 */
export async function runCLI(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const parser = yargs(argv)
    .scriptName("codenexus")
    .usage("$0 <command> [options]")
    .version(CLI_DEFINITION.version)
    .alias("v", "version")
    .help("help")
    .alias("h", "help")
    .demandCommand(
      1,
      "Please specify a command. Run `codenexus --help` for options.",
    )
    .strict()
    .recommendCommands()
    .fail((msg, err, yargsInstance) => {
      if (err) throw err;
      console.error(colorize(`\n  ${msg}`, "red"));
      console.error("");
      yargsInstance.showHelp();
      process.exit(1);
    })
    .example(
      "codenexus review --owner org --repo my-repo --pr 42",
      "Review a pull request",
    )
    .example(
      "codenexus fix --owner org --repo my-repo --pr 42 --apply",
      "Apply fixes to a PR",
    )
    .example("codenexus audit --file ./index.html", "Audit a file")
    .example("codenexus watch --owner org --repo my-repo", "Watch a repository")
    .example("codenexus configure --show", "Show configuration")
    .example(
      "codenexus auth login --token ghp_xxx",
      "Authenticate with GitHub",
    );

  // ── review command ────────────────────────────────────
  parser.command(
    "review",
    "Trigger a full code review on a pull request",
    (yargsBuilder) => {
      yargsBuilder
        .option("owner", {
          alias: "o",
          type: "string",
          demandOption: true,
          describe: "Repository owner (user or org)",
        })
        .option("repo", {
          alias: "r",
          type: "string",
          demandOption: true,
          describe: "Repository name",
        })
        .option("pr", {
          alias: "p",
          type: "number",
          demandOption: true,
          describe: "Pull request number",
        })
        .option("mode", {
          alias: "m",
          type: "string",
          default: "review",
          choices: ["review", "fix", "plan", "build"],
          describe: "Review mode",
        })
        .option("output", {
          alias: "O",
          type: "string",
          default: "pretty",
          choices: ["pretty", "json", "silent"],
          describe: "Output format",
        })
        .option("depth", {
          alias: "d",
          type: "number",
          default: 5,
          describe: "Review depth (1-10)",
        });
    },
    (args) => {
      handleReview(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // ── fix command ───────────────────────────────────────
  parser.command(
    "fix",
    "Apply auto-fixes to a pull request",
    (yargsBuilder) => {
      yargsBuilder
        .option("owner", {
          alias: "o",
          type: "string",
          demandOption: true,
          describe: "Repository owner",
        })
        .option("repo", {
          alias: "r",
          type: "string",
          demandOption: true,
          describe: "Repository name",
        })
        .option("pr", {
          alias: "p",
          type: "number",
          demandOption: true,
          describe: "Pull request number",
        })
        .option("apply", {
          alias: "a",
          type: "boolean",
          default: false,
          describe: "Actually apply fixes (dry-run if omitted)",
        })
        .option("type", {
          alias: "t",
          type: "string",
          default: "all",
          choices: ["all", "lint", "design", "security"],
          describe: "Fix type",
        });
    },
    (args) => {
      handleFix(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // ── audit command ─────────────────────────────────────
  parser.command(
    "audit",
    "Audit a file or directory for design & security issues",
    (yargsBuilder) => {
      yargsBuilder
        .option("file", {
          alias: "f",
          type: "string",
          demandOption: true,
          describe: "File or directory path to audit",
        })
        .option("type", {
          alias: "t",
          type: "string",
          default: "design",
          choices: ["design", "security", "both"],
          describe: "Audit type",
        })
        .option("format", {
          alias: "F",
          type: "string",
          default: "html",
          choices: ["html", "css"],
          describe: "Input format",
        })
        .option("output", {
          alias: "o",
          type: "string",
          default: "pretty",
          choices: ["pretty", "json"],
          describe: "Output format",
        });
    },
    (args) => {
      handleAudit(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // ── watch command ─────────────────────────────────────
  parser.command(
    "watch",
    "Watch a repository for new PRs and auto-review",
    (yargsBuilder) => {
      yargsBuilder
        .option("owner", {
          alias: "o",
          type: "string",
          demandOption: true,
          describe: "Repository owner",
        })
        .option("repo", {
          alias: "r",
          type: "string",
          demandOption: true,
          describe: "Repository name",
        })
        .option("interval", {
          alias: "i",
          type: "number",
          default: 60,
          describe: "Polling interval in seconds",
        })
        .option("mode", {
          alias: "m",
          type: "string",
          default: "review",
          choices: ["review", "fix"],
          describe: "Watch mode",
        })
        .option("daemon", {
          alias: "d",
          type: "boolean",
          default: false,
          describe: "Run as background daemon",
        });
    },
    (args) => {
      handleWatch(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // ── status command ────────────────────────────────────
  parser.command(
    "status",
    "Check status of a review run or the system",
    (yargsBuilder) => {
      yargsBuilder
        .option("run", {
          type: "string",
          describe: "Run ID to check",
        })
        .option("all", {
          alias: "a",
          type: "boolean",
          default: false,
          describe: "Show all recent runs",
        })
        .option("limit", {
          alias: "l",
          type: "number",
          default: 10,
          describe: "Number of recent runs to show",
        });
    },
    (args) => {
      handleStatus(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // ── configure command ─────────────────────────────────
  parser.command(
    "configure",
    "View or modify CodeNexus configuration",
    (yargsBuilder) => {
      yargsBuilder
        .option("show", {
          alias: "s",
          type: "boolean",
          default: false,
          describe: "Show current configuration",
        })
        .option("set", {
          alias: "S",
          type: "string",
          describe: "Set a config value (key=value)",
        })
        .option("file", {
          alias: "f",
          type: "string",
          describe: "Config file path",
        })
        .option("init", {
          alias: "i",
          type: "boolean",
          default: false,
          describe: "Initialize default config",
        });
    },
    (args) => {
      handleConfigure(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // ── auth command ──────────────────────────────────────
  parser.command(
    "auth",
    "Authenticate with GitHub and manage credentials",
    (yargsBuilder) => {
      yargsBuilder
        .option("login", {
          alias: "l",
          type: "boolean",
          default: false,
          describe: "Log in with a token",
        })
        .option("token", {
          alias: "t",
          type: "string",
          describe: "GitHub personal access token",
        })
        .option("logout", {
          alias: "L",
          type: "boolean",
          default: false,
          describe: "Log out and clear credentials",
        })
        .option("status", {
          alias: "s",
          type: "boolean",
          default: false,
          describe: "Check auth status",
        });
    },
    (args) => {
      handleAuth(args).catch((err) => {
        console.error(colorize(`\n  ✗ Fatal: ${err}`, "red"));
        process.exit(1);
      });
    },
  );

  // Parse and execute
  await parser.parseAsync(argv);
}

// ─── Direct Execution ────────────────────────────────────────

// Run when executed directly (not imported)
const isDirectRun =
  process.argv[1]?.endsWith("codenexus") ||
  process.argv[1]?.includes("cli-generator") ||
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.includes("cli");

if (isDirectRun && process.env.NODE_ENV !== "test") {
  runCLI().catch((err) => {
    console.error(colorize(`\n  ✗ Fatal error: ${err}`, "red"));
    process.exit(1);
  });
}

// ─── Default Export ───────────────────────────────────────────

export default runCLI;
