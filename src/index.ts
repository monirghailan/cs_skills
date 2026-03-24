#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REPO = "monirghailan/cs_skills";
const DEFAULT_BRANCH = "main";

interface SkillEntry {
  name: string;
  description: string;
  files: string[];
}

interface Registry {
  version: string;
  skills: SkillEntry[];
}

function getRepoConfig() {
  const repo = process.env.CS_SKILLS_REPO || DEFAULT_REPO;
  const branch = process.env.CS_SKILLS_BRANCH || DEFAULT_BRANCH;
  return { repo, branch };
}

function getRawUrl(filePath: string): string {
  const { repo, branch } = getRepoConfig();
  return `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchRegistry(): Promise<Registry> {
  const url = getRawUrl("skills/registry.json");
  const text = await fetchText(url);
  return JSON.parse(text) as Registry;
}

async function fetchLocalRegistry(): Promise<Registry | null> {
  const localPath = path.resolve(__dirname, "..", "skills", "registry.json");
  try {
    const text = await fs.readFile(localPath, "utf-8");
    return JSON.parse(text) as Registry;
  } catch {
    return null;
  }
}

async function getRegistry(): Promise<Registry> {
  try {
    return await fetchRegistry();
  } catch {
    const local = await fetchLocalRegistry();
    if (local) {
      return local;
    }
    throw new Error(
      "Could not fetch registry from GitHub or find a local copy. " +
      "Check CS_SKILLS_REPO env var or ensure skills/registry.json exists."
    );
  }
}

async function fetchSkillFile(skillName: string, fileName: string): Promise<string> {
  const url = getRawUrl(`skills/${skillName}/${fileName}`);
  try {
    return await fetchText(url);
  } catch {
    const localPath = path.resolve(__dirname, "..", "skills", skillName, fileName);
    return fs.readFile(localPath, "utf-8");
  }
}

class CsSkillsServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer(
      {
        name: "cs_skills",
        version: "1.0.0",
        description: "Browse and install Cursor skills from a shared registry.",
      },
      {
        capabilities: { tools: {} },
        instructions:
          "Use this server to browse available Cursor skills and install them. " +
          "Start with list_skills to see what's available, use get_skill to preview " +
          "a skill's content, and install_skill to download it into the user's " +
          ".cursor/skills/ directory.",
      },
    );

    this.registerTools();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.server.onerror = (error) => {
      console.error("[cs_skills Error]", error);
    };

    const shutdown = async () => {
      this.server.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
  }

  private registerTools(): void {
    this.server.tool(
      "list_skills",
      "List all available skills in the registry with their names and descriptions.",
      {},
      async () => {
        const registry = await getRegistry();

        if (registry.skills.length === 0) {
          return {
            content: [{ type: "text", text: "No skills available in the registry." }],
          };
        }

        const lines = registry.skills.map(
          (s) => `- **${s.name}**: ${s.description} (${s.files.length} file${s.files.length !== 1 ? "s" : ""})`
        );

        const text = `# Available Skills (${registry.skills.length})\n\n${lines.join("\n")}`;

        return {
          content: [{ type: "text", text }],
        };
      },
    );

    this.server.tool(
      "get_skill",
      "Preview a skill's full SKILL.md content before installing it.",
      {
        skillName: z.string().describe("Name of the skill to preview (from list_skills)"),
      },
      async ({ skillName }) => {
        const registry = await getRegistry();
        const skill = registry.skills.find((s) => s.name === skillName);

        if (!skill) {
          const available = registry.skills.map((s) => s.name).join(", ");
          return {
            content: [{
              type: "text",
              text: `Skill "${skillName}" not found. Available skills: ${available}`,
            }],
            isError: true,
          };
        }

        const content = await fetchSkillFile(skillName, "SKILL.md");

        return {
          content: [{
            type: "text",
            text: `# ${skillName}\n\n${content}`,
          }],
        };
      },
    );

    this.server.tool(
      "install_skill",
      "Download and install a skill into the user's Cursor skills directory.",
      {
        skillName: z.string().describe("Name of the skill to install (from list_skills)"),
        location: z
          .enum(["project", "personal"])
          .default("project")
          .describe(
            'Where to install: "project" (.cursor/skills/ in cwd) or "personal" (~/.cursor/skills/)'
          ),
      },
      async ({ skillName, location }) => {
        const registry = await getRegistry();
        const skill = registry.skills.find((s) => s.name === skillName);

        if (!skill) {
          const available = registry.skills.map((s) => s.name).join(", ");
          return {
            content: [{
              type: "text",
              text: `Skill "${skillName}" not found. Available skills: ${available}`,
            }],
            isError: true,
          };
        }

        const baseDir =
          location === "personal"
            ? path.join(process.env.HOME || "~", ".cursor", "skills")
            : path.join(process.cwd(), ".cursor", "skills");

        const skillDir = path.join(baseDir, skillName);
        await fs.mkdir(skillDir, { recursive: true });

        const installed: string[] = [];
        const errors: string[] = [];

        for (const fileName of skill.files) {
          try {
            const content = await fetchSkillFile(skillName, fileName);
            const filePath = path.join(skillDir, fileName);
            const fileDir = path.dirname(filePath);
            await fs.mkdir(fileDir, { recursive: true });
            await fs.writeFile(filePath, content, "utf-8");
            installed.push(fileName);
          } catch (err) {
            errors.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        let text = `# Installed: ${skillName}\n\n`;
        text += `**Location:** ${skillDir}\n\n`;

        if (installed.length > 0) {
          text += `**Files installed:**\n${installed.map((f) => `- ${f}`).join("\n")}\n\n`;
        }

        if (errors.length > 0) {
          text += `**Errors:**\n${errors.map((e) => `- ${e}`).join("\n")}\n\n`;
        }

        text += installed.length > 0
          ? "Skill is ready to use. It will be picked up by Cursor automatically."
          : "No files were installed due to errors.";

        return {
          content: [{ type: "text", text }],
          isError: errors.length > 0 && installed.length === 0,
        };
      },
    );
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("cs_skills MCP Server running on stdio");
  }
}

const server = new CsSkillsServer();
server.run().catch(console.error);

export { CsSkillsServer };
