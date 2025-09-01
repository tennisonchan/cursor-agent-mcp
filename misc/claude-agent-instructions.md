# Claude Code – Agent Instructions for Using cursor-agent MCP

Audience: Claude (and advanced users configuring Claude Code)

Goal: Minimize Claude’s token usage and cost by delegating repo-aware work to the cursor-agent CLI via this MCP server, while keeping Claude’s own context small and interactions deterministic.

Reference implementation: [mcp-cursor-agent/server.js](mcp-cursor-agent/server.js) • [mcp-cursor-agent/README.md](mcp-cursor-agent/README.md) • [mcp-cursor-agent/test_client.mjs](mcp-cursor-agent/test_client.mjs)


## Why

- Cost/Token control
  - Asking Claude to read large codebases consumes context window and tokens. Redirect the heavy lifting (search, analysis, planning, edits) to `cursor-agent` with tight scopes and concise outputs.
- Purpose-built tools
  - This MCP exposes focused tools: chat, edit, analyze, search, plan, and raw. They guide smaller prompts with narrower scopes, lowering token usage and noise.
- Deterministic process
  - Tool calls return consistent shapes, timeouts, and diagnostics; easier to chain, summarize, and store without flooding Claude’s context.


## Where this is implemented

- Tool registrations begin at [JavaScript.server.tool()](mcp-cursor-agent/server.js:273).
- Common executor that runs the CLI lives in [JavaScript.invokeCursorAgent()](mcp-cursor-agent/server.js:38).
- Legacy runner for single-shot chat is [JavaScript.runCursorAgent()](mcp-cursor-agent/server.js:153).
- Full user documentation is in [mcp-cursor-agent/README.md](mcp-cursor-agent/README.md).


## When to use cursor-agent (instead of having Claude read files directly)

Use cursor-agent when:
- You need repository-wide analysis, code search, or multi-file reasoning.
- You can narrow the scope with paths or globs (src/**, app/**) to limit token footprint.
- You want structured or concise output (text/markdown/json) without dumping large source into the chat.
- You are planning a task that can be expressed as steps and constraints (set up CI, refactor plan, etc.).
- You need quick edits guided by a specific instruction (propose patch/diff or apply changes if supported).

Avoid or minimize using cursor-agent when:
- You need to inspect a single small file and the content fits naturally inline in the conversation.
- You need model-specific features in Claude that don’t map well to the CLI (rare).
- A quick direct answer is faster than spawning a CLI process (e.g., trivial Q&A with no code context).


## Tool Overview and Decision Guide

All tools accept COMMON fields: output_format ("text"|"markdown"|"json", default "text"), extra_args?: string[], cwd?: string, executable?: string, model?: string, force?: boolean, echo_prompt?: boolean.

- cursor_agent_chat
  - Use for general Q&A with a concise prompt.
  - Prefer this over free-form chats when the question doesn’t need repo traversal.

- cursor_agent_edit_file
  - Use for targeted edits/suggestions to a known file.
  - Provide: { file, instruction, dry_run?: boolean, apply?: boolean, prompt?: string }
  - Good for diffs or guided changes with minimal tokens.

- cursor_agent_analyze_files
  - Use for scoped analysis on specific directories/files.
  - Provide: { paths: string|string[], prompt?: string }
  - Add a brief prompt for focus, e.g., “architecture overview,” “find race conditions.”

- cursor_agent_search_repo
  - Use for code/search queries with include/exclude globs.
  - Provide: { query, include?: string|string[], exclude?: string|string[] }
  - Ensures you only scan relevant parts of the repo.

- cursor_agent_plan_task
  - Use for plans/checklists with constraints.
  - Provide: { goal, constraints?: string[] }
  - Output as numbered steps; shallow context, lower cost.

- cursor_agent_raw
  - Escape hatch for advanced usage: provide argv and choose whether to inject print mode.
  - Provide: { argv: string[], print?: boolean }
  - Use sparingly; prefer verbs above for clear intent and cheaper prompts.



## Cost-first Patterns (Do/Don’t)

Do:
- Provide narrow scopes (paths/globs) before asking for repo work.
- Set output_format to "text" or "markdown" unless you need machine-readable "json".
- Ask for top-N results and short, bullet summaries. Example: “At most 10 matches. Include path and line.”
- Use echo_prompt only during debugging (it adds text to the result).

Don’t:
- Request full-file dumps or whole-repo scans without filters.
- Ask for verbose narratives when a bullet list suffices.
- Keep DEBUG on in production; use it locally.

Tip: The MCP supports echoing the prompt into the tool output when CURSOR_AGENT_ECHO_PROMPT=1 or echo_prompt=true is passed. Use this during setup then disable for cost savings.


## Example Invocations

- Search for a symbol inside TypeScript only:
  - Tool: cursor_agent_search_repo
  - Arguments:
    {
      "query": "createServer(",
      "include": ["src/**/*.ts", "server/**/*.ts"],
      "exclude": ["node_modules/**", "dist/**"],
      "output_format": "markdown"
    }

- Analyze architecture of src and scripts:
  - Tool: cursor_agent_analyze_files
  - Arguments:
    {
      "paths": ["src", "scripts"],
      "prompt": "Summarize the architecture and main responsibilities of each module. Keep it under 250 words.",
      "output_format": "text"
    }

- Edit a single file with a targeted instruction (dry run):
  - Tool: cursor_agent_edit_file
  - Arguments:
    {
      "file": "src/app.ts",
      "instruction": "Extract the HTTP client into a separate module and add a retry wrapper. Propose a patch.",
      "dry_run": true,
      "output_format": "markdown"
    }

- Plan a task under constraints:
  - Tool: cursor_agent_plan_task
  - Arguments:
    {
      "goal": "Set up CI to lint and test this repo",
      "constraints": ["GitHub Actions", "Node 18", "Cache npm deps"],
      "output_format": "markdown"
    }

- General chat (lowest overhead):
  - Tool: cursor_agent_chat
  - Arguments:
    { "prompt": "Explain SIMD in one paragraph", "output_format": "markdown" }


## Prompts that Save Tokens

- Prefer short, targeted objectives:
  - “List 10 references of X in src/**/*.ts with file and line.”
  - “Summarize the structure of src/, skip node_modules and dist.”
  - “Propose a minimal diff to fix the bug in src/app.ts (no code dumps).”
- Avoid long narratives and raw code dumps unless essential.
- Add constraints up front: length limits, sections to include/exclude, outline structure.

Examples of short templates:
- “Provide at most N bullet points with file:line and a one-sentence context.”
- “Return a numbered plan of 5–7 steps to achieve X under constraints Y.”
- “Summarize module boundaries across these paths: A, B, C. 200 words.”


## Failure Handling and Retries

- Timeouts:
  - The CLI runs under a hard timeout; if it hits the ceiling, ask again with narrower scopes or increase timeout via env (see README).
- Idle kill:
  - Disabled by default. Don’t rely on idle-kill for normal work; use hard timeouts and focused prompts.
- Unknown CLI errors:
  - Suggest using cursor_agent_raw with argv ["--version"] to validate CLI availability.
- Credential/Model issues:
  - Report a concise diagnostic and request user to set CURSOR_AGENT_MODEL and provider credentials.

In case of failure:
1) Reduce scope (paths/globs/top-N); 2) tighten prompt; 3) increase CURSOR_AGENT_TIMEOUT_MS only if needed.


## Environment Defaults for Claude Code

Host config example is in [mcp-cursor-agent/README.md](mcp-cursor-agent/README.md), but for the agent:

- Prefer these env defaults for stability/cost:
  - CURSOR_AGENT_IDLE_EXIT_MS="0"
  - CURSOR_AGENT_TIMEOUT_MS="60000"
  - CURSOR_AGENT_MODEL set to a cost-effective default
  - CURSOR_AGENT_ECHO_PROMPT="0" normally (set to "1" only when debugging)
- Optional diagnostics:
  - DEBUG_CURSOR_MCP="1" for local development (stderr logs, may not appear in Claude UI)
- Executable path:
  - CURSOR_AGENT_PATH="/abs/path/to/cursor-agent" if not on PATH


## Claude-specific Guidance (How to choose a tool)

Decision Tree:
- Do I need a plan/checklist? → use cursor_agent_plan_task.
- Do I need to search code across files? → use cursor_agent_search_repo with include/exclude.
- Do I need to analyze a subset of the repo? → use cursor_agent_analyze_files with paths.
- Do I need to change or propose edits to a file? → use cursor_agent_edit_file with instruction.
- Do I need a quick answer (no repo traversal)? → use cursor_agent_chat.
- Do I need a special CLI invocation? → use cursor_agent_raw, with print=false by default.

Post-processing:
- Always summarize tool outputs back to the user in a concise form (bullets or short markdown).
- When output_format="json", keep the JSON body intact and also provide a short natural-language summary to reduce context pressure.

Constraints:
- Avoid reprinting large code blocks unless explicitly requested.
- Use “top-N” or “limit to 10 results” patterns to cap output length.
- Prefer “text” or “markdown” outputs for summaries.


## Security and Safety

- Assume the repository may contain secrets. Do not echo or log secrets.
- Don’t instruct the CLI to fetch or transmit external data unless explicitly requested.
- For edits, prefer dry_run and propose diffs unless the user instructs to apply.
- Use shell: false in spawns (enforced by the server) and avoid passing shell metacharacters via extra_args.


## References (clickable)

- Tool definitions start at [JavaScript.server.tool()](mcp-cursor-agent/server.js:273)
- Executor: [JavaScript.invokeCursorAgent()](mcp-cursor-agent/server.js:38)
- Legacy runner: [JavaScript.runCursorAgent()](mcp-cursor-agent/server.js:153)
- Full README: [mcp-cursor-agent/README.md](mcp-cursor-agent/README.md)
- Smoke client: [mcp-cursor-agent/test_client.mjs](mcp-cursor-agent/test_client.mjs)