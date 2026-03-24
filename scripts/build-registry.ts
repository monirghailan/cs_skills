import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.resolve(__dirname, "..", "skills");

interface SkillEntry {
  name: string;
  description: string;
  files: string[];
}

interface Registry {
  version: string;
  updatedAt: string;
  skills: SkillEntry[];
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = value;
  }

  return frontmatter;
}

async function collectFiles(dir: string, base: string = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await collectFiles(path.join(dir, entry.name), relative);
      files.push(...nested);
    } else {
      files.push(relative);
    }
  }

  return files;
}

async function buildRegistry(): Promise<void> {
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
  const skills: SkillEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    try {
      await fs.access(skillMdPath);
    } catch {
      console.warn(`Skipping ${entry.name}: no SKILL.md found`);
      continue;
    }

    const content = await fs.readFile(skillMdPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter.name || !frontmatter.description) {
      console.warn(`Skipping ${entry.name}: missing name or description in frontmatter`);
      continue;
    }

    const files = await collectFiles(skillDir);

    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      files,
    });

    console.log(`Added: ${frontmatter.name} (${files.length} files)`);
  }

  const registry: Registry = {
    version: "1.0.0",
    updatedAt: new Date().toISOString(),
    skills,
  };

  const outputPath = path.join(SKILLS_DIR, "registry.json");
  await fs.writeFile(outputPath, JSON.stringify(registry, null, 2), "utf-8");
  console.log(`\nRegistry written to ${outputPath} (${skills.length} skills)`);
}

buildRegistry().catch(console.error);
