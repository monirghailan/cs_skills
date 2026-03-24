# cs_skills

MCP server for browsing and installing shared Cursor skills from a central registry.

## Setup

Add to your Cursor MCP config (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "cs_skills": {
      "command": "npx",
      "args": ["-y", "cs_skills"]
    }
  }
}
```

Restart Cursor, then ask your AI assistant:

- *"What skills are available?"*
- *"Show me the apex-log-analysis skill"*
- *"Install the apex-log-analysis skill"*

## Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_skills` | none | List all available skills with names and descriptions |
| `get_skill` | `skillName` | Preview a skill's full SKILL.md content |
| `install_skill` | `skillName`, `location` | Install a skill to project (`.cursor/skills/`) or personal (`~/.cursor/skills/`) directory |

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `CS_SKILLS_REPO` | `monirghailan/cs_skills` | GitHub repo to fetch skills from |
| `CS_SKILLS_BRANCH` | `main` | Branch to fetch from |

To use a custom repo:

```json
{
  "mcpServers": {
    "cs_skills": {
      "command": "npx",
      "args": ["-y", "cs_skills"],
      "env": {
        "CS_SKILLS_REPO": "your-org/your-skills-repo"
      }
    }
  }
}
```

## Publishing Skills

1. Create a folder under `skills/` with your skill name
2. Add a `SKILL.md` with frontmatter (`name` and `description` required)
3. Run `npx tsx scripts/build-registry.ts` to regenerate `skills/registry.json`
4. Commit and push

### SKILL.md format

```markdown
---
name: my-skill
description: What this skill does and when to use it.
---

# My Skill

Instructions for the AI assistant...
```

## Development

```bash
npm install
npm run build
node dist/index.js
```
