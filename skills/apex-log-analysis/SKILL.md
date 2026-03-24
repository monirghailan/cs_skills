---
name: apex-log-analysis
description: Analyze Salesforce Apex debug logs for performance bottlenecks, governor limit risks, and slow methods using the apex-log-mcp server. Use when the user asks to run anonymous Apex, analyze a debug log, investigate performance issues, or check governor limits.
---

# Apex Debug Log Analysis

## When to Use

- User asks to run anonymous Apex and review the results
- User provides a `.log` file for analysis
- User asks about performance, slow methods, or governor limits
- User wants to investigate a Salesforce transaction

## Workflow

### 1. Running Anonymous Apex

Execute Apex via the Salesforce CLI and save the log to a file:

```bash
echo "<apex_code>" | sf apex run --target-org <org_alias> 2>&1 | tee /tmp/apex-debug.log
```

- Default org: `Liquid_DevPro`
- Always use `--target-org` explicitly
- Requires `full_network` shell permission

### 2. Analyzing the Log

After obtaining a log file (from step 1 or provided by the user), use the `user-apex-log-mcp` MCP tools in this order:

**Quick overview first:**

Call `get_apex_log_summary` on the `user-apex-log-mcp` server with the absolute path to the log file. This returns total execution time, method count, SOQL/DML totals, governor limits, and active namespaces.

**Then dig deeper as needed:**

- `analyze_apex_log_performance` — ranks methods by self-execution time. Accepts optional `topMethods` (default 10), `minDuration` (ms), and `namespace` filter.
- `find_performance_bottlenecks` — flags governor limit usage above 80%. Accepts optional `analysisType`: `cpu`, `database`, `methods`, or `all` (default).

### 3. Presenting Results

Summarize findings in plain language:
- Highlight the slowest methods and their execution times
- Flag any governor limits approaching thresholds
- Break down time by namespace when relevant (e.g., `csordtelcoa` vs custom code)
- Provide actionable optimization recommendations

## Important Notes

- All MCP tool durations are in **milliseconds**
- The MCP tools require an **absolute file path** to the `.log` file
- Always prefer MCP analysis tools over manually reading raw log output
- For simple Apex execution where performance analysis is not needed, the raw CLI output is sufficient
