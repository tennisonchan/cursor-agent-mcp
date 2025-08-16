# misc/ — Instructions for Claude Code + cursor-agent MCP

Purpose
- This folder holds human- and agent-readable instruction files that guide how Claude Code should use the cursor-agent MCP to reduce tokens and cost.

What’s inside
- Project policy (paste into Claude’s Project Instructions): [misc/claude-project-instructions.md](misc/claude-project-instructions.md)
- Agent policy (behavior for the MCP/tool side): [misc/cursor-agent-instructions.md](misc/cursor-agent-instructions.md)
- Extended guide (optional, longer form): [misc/claude-agent-instructions.md](misc/claude-agent-instructions.md)

Why separate docs?
- Keeps operational guidance out of code, easy to copy/paste into Claude.
- Establishes clear host (Claude) vs agent (cursor-agent) responsibilities for cost‑aware workflows.

See also
- Server entry: [mcp-cursor-agent/server.js](mcp-cursor-agent/server.js)
- Main docs: [mcp-cursor-agent/README.md](mcp-cursor-agent/README.md)
## Multi-MCP note: Gemini CLI and cursor-agent

Claude Code can use multiple MCP servers simultaneously. Besides this repo’s cursor-agent MCP, you can also integrate a Gemini CLI MCP and route tasks to either tool based on cost/scope.

- Example Gemini CLI MCP usage and instructions:
  - https://github.com/sailay1996/random-stuff/blob/main/AI/claudecodeXgeminicli/Claude_instrctuons1.md

Suggested pattern:
- Prefer cursor-agent MCP for repo-scoped tasks (search/analyze/plan/edit) when you want tight control of scope and concise outputs.
- Prefer Gemini CLI MCP when you need very large context windows or Gemini-specific capabilities.
- Keep Claude’s Project Instructions neutral: “Use the most cost‑effective MCP (cursor-agent or Gemini CLI) for the task; always scope paths/globs and return concise results.”
Note: You can get a Gemini CLI MCP implementation here:
- https://github.com/jamubc/gemini-mcp-tool
