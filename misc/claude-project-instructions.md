# Claude Code – Project Instructions (Use cursor-agent MCP to reduce tokens/cost)

Audience: Claude Code (the assistant running inside the editor)

Intent
- Primary goal is to keep token usage and cost low.
- Delegate repo-aware work (reading, searching, analyzing, planning, editing) to the cursor-agent MCP tools instead of loading large context into chat.
- Keep your own conversation context small; request concise, scoped outputs from tools.

Background
- The project includes a custom MCP server that wraps the `cursor-agent` CLI and exposes focused tools: chat, edit_file, analyze_files, search_repo, plan_task, raw, run.
- Server entry: [mcp-cursor-agent/server.js](mcp-cursor-agent/server.js)

Core Policy (always follow)
1) Prefer MCP tools over inline reading when the task can be scoped (paths/globs/top-N):
   - Large or multi-file review → use cursor_agent_analyze_files
   - Codebase search → use cursor_agent_search_repo
   - Task/roadmap creation → use cursor_agent_plan_task
   - Targeted file change or patch suggestion → use cursor_agent_edit_file
   - General Q&A without repo traversal → use cursor_agent_chat
   - Special CLI call → use cursor_agent_raw (advanced; use sparingly)

2) Minimize scope explicitly
   - Always pass specific paths/globs (include/exclude) for repo tasks.
   - Ask for “top N” results and short bullet summaries.

3) Keep outputs compact
   - Default output_format="text" or "markdown".
   - Use "json" only if the user asks for machine-readable output.

4) Don’t paste large code blocks into chat unless the user explicitly asks.
   - Prefer path + line references and tiny snippets (1–3 lines) as context.

5) Summarize tool results for the user
   - Provide a concise bullet summary in chat and, if applicable, a short next-step recommendation.

6) Confirm before long/expensive operations
   - If the task might traverse many files or run for a long time, ask the user to confirm scope and limits (paths, top N, time).

Tool Selection – Decision Flow
- Need quick answer, no code traversal → cursor_agent_chat
- Need to search across files/folders → cursor_agent_search_repo with include/exclude
- Need to review or summarize multiple files/areas → cursor_agent_analyze_files with paths
- Need a plan/checklist → cursor_agent_plan_task with constraints
- Need a targeted edit/patch → cursor_agent_edit_file with file + instruction (default to dry-run)
- Need special CLI invocation → cursor_agent_raw (confirm with user; default print=false)

Argument Patterns (examples)

A) Analyze a subset of the repo (scoped)
- Tool: cursor_agent_analyze_files
- Arguments:
  {
    "paths": ["src", "scripts"],
    "prompt": "Architecture overview + module boundaries, under 200 words.",
    "output_format": "text"
  }

B) Repository search (scoped)
- Tool: cursor_agent_search_repo
- Arguments:
  {
    "query": "createServer(",
    "include": ["src/**/*.ts", "server/**/*.ts"],
    "exclude": ["node_modules/**", "dist/**"],
    "output_format": "markdown"
  }

C) Targeted file edit (dry run)
- Tool: cursor_agent_edit_file
- Arguments:
  {
    "file": "src/app.ts",
    "instruction": "Extract the HTTP client into a separate module; add exponential backoff retries. Propose a unified diff.",
    "dry_run": true,
    "output_format": "markdown"
  }

D) Plan with constraints
- Tool: cursor_agent_plan_task
- Arguments:
  {
    "goal": "Set up CI to lint and test this repo",
    "constraints": ["GitHub Actions", "Node 18", "Cache npm deps"],
    "output_format": "markdown"
  }

Cost-First Prompt Templates
- “Return at most 10 results as bullets: file:line — 1 sentence context.”
- “Summarize modules across paths A,B,C in ≤200 words; avoid code dumps.”
- “Propose a minimal unified diff; no full file listings.”

Anti-Patterns (avoid)
- Whole-repo scans without include/exclude scopes
- Large code blocks pasted into chat
- Verbose narrative when bullets or a short summary suffice

Debug/Visibility
- If user wants to see the exact tool prompt in the UI, include "echo_prompt": true in arguments.
- Do not enable excessive debugging by default. Only use broader streaming (cursor_agent_raw) when necessary and agreed.

Failure Handling
- If a tool times out or returns too large an output, reduce scope (paths/globs/top-N) and retry.
- Ask the user to confirm broader scopes before re-running.

Summary Rule
- Use MCP tools to do the heavy lifting and keep chat context small.
- Explicitly scope tasks; request concise outputs.
- Confirm with the user before long scans or broad changes.