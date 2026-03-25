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
function getRepoConfig() {
    const repo = process.env.CS_SKILLS_REPO || DEFAULT_REPO;
    const branch = process.env.CS_SKILLS_BRANCH || DEFAULT_BRANCH;
    return { repo, branch };
}
function getRawUrl(filePath) {
    const { repo, branch } = getRepoConfig();
    return `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
}
async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
}
async function fetchRegistry() {
    const url = getRawUrl("skills/registry.json");
    const text = await fetchText(url);
    return JSON.parse(text);
}
async function fetchLocalRegistry() {
    const localPath = path.resolve(__dirname, "..", "skills", "registry.json");
    try {
        const text = await fs.readFile(localPath, "utf-8");
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
async function getRegistry() {
    try {
        return await fetchRegistry();
    }
    catch {
        const local = await fetchLocalRegistry();
        if (local) {
            return local;
        }
        throw new Error("Could not fetch registry from GitHub or find a local copy. " +
            "Check CS_SKILLS_REPO env var or ensure skills/registry.json exists.");
    }
}
async function fetchSkillFile(skillName, fileName) {
    const url = getRawUrl(`skills/${skillName}/${fileName}`);
    try {
        return await fetchText(url);
    }
    catch {
        const localPath = path.resolve(__dirname, "..", "skills", skillName, fileName);
        return fs.readFile(localPath, "utf-8");
    }
}
function generateDiff(localContent, remoteContent) {
    const localLines = localContent.split("\n");
    const remoteLines = remoteContent.split("\n");
    const diff = [];
    const maxLen = Math.max(localLines.length, remoteLines.length);
    for (let i = 0; i < maxLen; i++) {
        const local = localLines[i];
        const remote = remoteLines[i];
        if (local === undefined) {
            diff.push(`+ ${remote}`);
        }
        else if (remote === undefined) {
            diff.push(`- ${local}`);
        }
        else if (local !== remote) {
            diff.push(`- ${local}`);
            diff.push(`+ ${remote}`);
        }
    }
    return diff.length > 0 ? diff.join("\n") : "";
}
function resolveSkillsDir(location) {
    return location === "personal"
        ? path.join(process.env.HOME || "~", ".cursor", "skills")
        : path.join(process.cwd(), ".cursor", "skills");
}
async function readLocalSkillFile(skillName, fileName, location) {
    const filePath = path.join(resolveSkillsDir(location), skillName, fileName);
    try {
        return await fs.readFile(filePath, "utf-8");
    }
    catch {
        return null;
    }
}
async function isSkillInstalled(skillName, location) {
    const skillDir = path.join(resolveSkillsDir(location), skillName);
    try {
        await fs.access(skillDir);
        return true;
    }
    catch {
        return false;
    }
}
class CsSkillsServer {
    server;
    constructor() {
        this.server = new McpServer({
            name: "cs_skills",
            version: "1.0.0",
            description: "Browse and install Cursor skills from a shared registry.",
        }, {
            capabilities: { tools: {} },
            instructions: "Use this server to browse available Cursor skills and install them. " +
                "Start with list_skills to see what's available, use get_skill to preview " +
                "a skill's content, and install_skill to download it into the user's " +
                ".cursor/skills/ directory. Use check_skill_updates to compare installed " +
                "skills against the registry and show diffs, then update_skill to apply updates.",
        });
        this.registerTools();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.server.onerror = (error) => {
            console.error("[cs_skills Error]", error);
        };
        const shutdown = async () => {
            this.server.close();
            process.exit(0);
        };
        process.once("SIGINT", shutdown);
    }
    registerTools() {
        this.server.tool("list_skills", "List all available skills in the registry with their names and descriptions.", {}, async () => {
            const registry = await getRegistry();
            if (registry.skills.length === 0) {
                return {
                    content: [{ type: "text", text: "No skills available in the registry." }],
                };
            }
            const lines = registry.skills.map((s) => `- **${s.name}**: ${s.description} (${s.files.length} file${s.files.length !== 1 ? "s" : ""})`);
            const text = `# Available Skills (${registry.skills.length})\n\n${lines.join("\n")}`;
            return {
                content: [{ type: "text", text }],
            };
        });
        this.server.tool("get_skill", "Preview a skill's full SKILL.md content before installing it.", {
            skillName: z.string().describe("Name of the skill to preview (from list_skills)"),
        }, async ({ skillName }) => {
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
        });
        this.server.tool("install_skill", "Download and install a skill into the user's Cursor skills directory.", {
            skillName: z.string().describe("Name of the skill to install (from list_skills)"),
            location: z
                .enum(["project", "personal"])
                .default("project")
                .describe('Where to install: "project" (.cursor/skills/ in cwd) or "personal" (~/.cursor/skills/)'),
        }, async ({ skillName, location }) => {
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
            const baseDir = location === "personal"
                ? path.join(process.env.HOME || "~", ".cursor", "skills")
                : path.join(process.cwd(), ".cursor", "skills");
            const skillDir = path.join(baseDir, skillName);
            await fs.mkdir(skillDir, { recursive: true });
            const installed = [];
            const errors = [];
            for (const fileName of skill.files) {
                try {
                    const content = await fetchSkillFile(skillName, fileName);
                    const filePath = path.join(skillDir, fileName);
                    const fileDir = path.dirname(filePath);
                    await fs.mkdir(fileDir, { recursive: true });
                    await fs.writeFile(filePath, content, "utf-8");
                    installed.push(fileName);
                }
                catch (err) {
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
        });
        this.server.tool("check_skill_updates", "Compare locally installed skills against the registry and show what has changed. Checks a single skill or all installed skills.", {
            skillName: z
                .string()
                .optional()
                .describe("Name of a specific skill to check. If omitted, checks all installed skills."),
            location: z
                .enum(["project", "personal"])
                .default("project")
                .describe('Where to look for installed skills: "project" (.cursor/skills/ in cwd) or "personal" (~/.cursor/skills/)'),
        }, async ({ skillName, location }) => {
            const registry = await getRegistry();
            const skillsToCheck = skillName
                ? registry.skills.filter((s) => s.name === skillName)
                : registry.skills;
            if (skillName && skillsToCheck.length === 0) {
                const available = registry.skills.map((s) => s.name).join(", ");
                return {
                    content: [{
                            type: "text",
                            text: `Skill "${skillName}" not found in registry. Available: ${available}`,
                        }],
                    isError: true,
                };
            }
            const results = [];
            let updatesAvailable = 0;
            for (const skill of skillsToCheck) {
                const installed = await isSkillInstalled(skill.name, location);
                if (!installed) {
                    results.push(`**${skill.name}**: Not installed`);
                    continue;
                }
                const fileDiffs = [];
                for (const fileName of skill.files) {
                    const localContent = await readLocalSkillFile(skill.name, fileName, location);
                    if (localContent === null) {
                        fileDiffs.push(`\n### ${fileName} — NEW FILE (not present locally)\n`);
                        const remoteContent = await fetchSkillFile(skill.name, fileName);
                        fileDiffs.push("```\n" + remoteContent.slice(0, 500) + (remoteContent.length > 500 ? "\n..." : "") + "\n```");
                        continue;
                    }
                    const remoteContent = await fetchSkillFile(skill.name, fileName);
                    if (localContent === remoteContent) {
                        continue;
                    }
                    const diff = generateDiff(localContent, remoteContent);
                    fileDiffs.push(`\n### ${fileName}\n\`\`\`diff\n${diff}\n\`\`\``);
                }
                if (fileDiffs.length === 0) {
                    results.push(`**${skill.name}**: Up to date`);
                }
                else {
                    updatesAvailable++;
                    results.push(`**${skill.name}**: Updates available${fileDiffs.join("\n")}`);
                }
            }
            let text = `# Skill Update Check\n\n`;
            text += updatesAvailable > 0
                ? `**${updatesAvailable} skill(s) have updates available.**\n\n`
                : `**All checked skills are up to date.**\n\n`;
            text += results.join("\n\n");
            if (updatesAvailable > 0) {
                text += `\n\nUse **update_skill** to apply updates.`;
            }
            return {
                content: [{ type: "text", text }],
            };
        });
        this.server.tool("update_skill", "Update a locally installed skill with the latest version from the registry.", {
            skillName: z.string().describe("Name of the skill to update (from check_skill_updates)"),
            location: z
                .enum(["project", "personal"])
                .default("project")
                .describe('Where the skill is installed: "project" (.cursor/skills/ in cwd) or "personal" (~/.cursor/skills/)'),
        }, async ({ skillName, location }) => {
            const registry = await getRegistry();
            const skill = registry.skills.find((s) => s.name === skillName);
            if (!skill) {
                const available = registry.skills.map((s) => s.name).join(", ");
                return {
                    content: [{
                            type: "text",
                            text: `Skill "${skillName}" not found in registry. Available: ${available}`,
                        }],
                    isError: true,
                };
            }
            const installed = await isSkillInstalled(skillName, location);
            if (!installed) {
                return {
                    content: [{
                            type: "text",
                            text: `Skill "${skillName}" is not installed at ${location} location. Use install_skill to install it first.`,
                        }],
                    isError: true,
                };
            }
            const baseDir = resolveSkillsDir(location);
            const skillDir = path.join(baseDir, skillName);
            const updated = [];
            const unchanged = [];
            const errors = [];
            for (const fileName of skill.files) {
                try {
                    const remoteContent = await fetchSkillFile(skillName, fileName);
                    const localContent = await readLocalSkillFile(skillName, fileName, location);
                    if (localContent === remoteContent) {
                        unchanged.push(fileName);
                        continue;
                    }
                    const filePath = path.join(skillDir, fileName);
                    const fileDir = path.dirname(filePath);
                    await fs.mkdir(fileDir, { recursive: true });
                    await fs.writeFile(filePath, remoteContent, "utf-8");
                    updated.push(fileName);
                }
                catch (err) {
                    errors.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            let text = `# Updated: ${skillName}\n\n`;
            text += `**Location:** ${skillDir}\n\n`;
            if (updated.length > 0) {
                text += `**Files updated:**\n${updated.map((f) => `- ${f}`).join("\n")}\n\n`;
            }
            if (unchanged.length > 0) {
                text += `**Already up to date:**\n${unchanged.map((f) => `- ${f}`).join("\n")}\n\n`;
            }
            if (errors.length > 0) {
                text += `**Errors:**\n${errors.map((e) => `- ${e}`).join("\n")}\n\n`;
            }
            text += updated.length > 0
                ? "Skill has been updated. Changes will be picked up by Cursor automatically."
                : "No files needed updating — skill is already at the latest version.";
            return {
                content: [{ type: "text", text }],
                isError: errors.length > 0 && updated.length === 0,
            };
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("cs_skills MCP Server running on stdio");
    }
}
const server = new CsSkillsServer();
server.run().catch(console.error);
export { CsSkillsServer };
//# sourceMappingURL=index.js.map