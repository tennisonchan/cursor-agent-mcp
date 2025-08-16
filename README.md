# Cursor Agent MCP Server

Minimal, hardened Model Context Protocol (MCP) server that wraps the `cursor-agent` CLI and exposes multiple, Claude‑friendly tools for chat, repository analysis, code search, planning, and more.

Core implementation: [mcp-cursor-agent/server.js](mcp-cursor-agent/server.js)
Test harness: [mcp-cursor-agent/test_client.mjs](mcp-cursor-agent/test_client.mjs)
Package manifest: [mcp-cursor-agent/package.json](mcp-cursor-agent/package.json)


## Purpose: reduce token usage and cost in Claude Code

This MCP exists to offload heavy “thinking” and repo‑aware tasks from the host (e.g., Claude Code) to the `cursor-agent` CLI. By letting the CLI handle analysis/planning/search with focused, prompt‑based instructions, you can:

- Scope work to only the needed files/paths instead of streaming the entire workspace.
- Choose a cost‑effective model via environment (or per call) and keep the host’s context small.
- Control response verbosity through `output_format` ("text" | "markdown" | "json") and tailored prompts.
- Use specialized tools (`analyze`, `search`, `plan`, `edit`) that produce targeted outputs rather than general chat.

### Cost‑control tips

- Prefer precise scopes:
  - Use `include`/`exclude` globs with `cursor_agent_search_repo` and curated `paths` for `cursor_agent_analyze_files`.
- Pick output formats intentionally:
  - Use `"text"` or `"markdown"` for concise answers. Reserve `"json"` only when you truly need structured output (it’s usually larger).
- Select a model that matches the task:
  - Set `CURSOR_AGENT_MODEL` to a cost‑effective default; override per tool call only when necessary.
- Avoid unnecessary echo/debug:
  - `CURSOR_AGENT_ECHO_PROMPT=1` is helpful during setup, but disables it later to save tokens in host logs.
  - Keep `DEBUG_CURSOR_MCP` off in normal use; it writes diagnostics to stderr (not counted in host tokens, but noisy).
- Control runtime instead of idle‑kill:
  - Keep `CURSOR_AGENT_IDLE_EXIT_MS="0"` so valid runs aren’t cut mid‑generation. Bound cost/time with `CURSOR_AGENT_TIMEOUT_MS` and focused prompts.
- Use `cursor_agent_raw` thoughtfully:
  - It’s powerful and can stream detailed sessions; for cheapest usage, prefer the focused tools with concise prompts and `"text"` output.
## Features

- Multi‑tool surface modeled after “verb-centric” CLIs
- Works well in Claude Code and other MCP hosts
- Safe process spawn (no shell), robust timeout handling
- Optional prompt echoing for easy debugging inside hosts
- Configurable defaults via environment variables (model, force, timeouts, executable path)
- Backward‑compatible legacy tool for single‑shot chat


## Requirements

- Node.js 18+ (tested up to Node 22)
- A working `cursor-agent` CLI in your PATH or at an explicit location
- Provider credentials configured for your chosen model (e.g., via the CLI’s own mechanism)


## Installation

1) Clone or download this repository.

2) Install dependencies for the MCP server:

```bash
cd ./mcp-cursor-agent
npm ci        # or: npm install
```

3) Ensure the cursor-agent CLI is installed and on PATH (or set CURSOR_AGENT_PATH):

```bash
cursor-agent --version
```

4) Run the MCP server:

```bash
# from the server directory
node ./server.js

# or from the repo root using the provided script
npm --prefix ./mcp-cursor-agent run start
```

### Do I need npx?

No. This server runs directly from the repository and is not published to npm (package.json sets "private": true). Use Node to execute `server.js` after installing dependencies as shown above.

If you later publish this as an npm package and add a `bin` entry in package.json, you could run it with `npx` and point your MCP host to that executable instead. Until then, prefer the Node-based command shown here.


## Quick smoke test (without an MCP host)

A tiny client is provided to list tools and call one of them over stdio:

```bash
# list tools and call chat with a prompt
node ./mcp-cursor-agent/test_client.mjs "Hello from smoke test"

# run the raw tool with --help (no implicit --print)
TEST_TOOL=cursor_agent_raw TEST_ARGV='["--help"]' node ./mcp-cursor-agent/test_client.mjs
```

The client uses the same stdio transport a host would use. See [JavaScript.main()](mcp-cursor-agent/test_client.mjs:4).


## How it works

All tool calls ultimately invoke the same executor [JavaScript.invokeCursorAgent()](mcp-cursor-agent/server.js:38), which:

- Resolves the `cursor-agent` executable (explicit path or PATH)
- Injects `--print` and `--output-format <fmt>` by default
- Optionally adds `-m <model>` and `-f` based on env/args
- Streams stdout/stderr and enforces a total timeout
- Optionally kills long‑idle processes (disabled by default)

The legacy wrapper [JavaScript.runCursorAgent()](mcp-cursor-agent/server.js:153) accepts a `prompt` and optional flags, composing the argv and delegating to the executor.


## Tools

These tools are registered in [JavaScript.server.tool()](mcp-cursor-agent/server.js:273) and below. All tools share the “COMMON” arguments:

- output_format: "text" | "json" | "markdown" (default "text")
- extra_args?: string[]
- cwd?: string
- executable?: string
- model?: string
- force?: boolean
- echo_prompt?: boolean  → prepend “Prompt used: …” to the result


### 1) cursor_agent_chat

- Args: { prompt: string, ...COMMON }
- Behavior: Single‑shot chat by passing the prompt as the final positional argument.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:273) → [JavaScript.runCursorAgent()](mcp-cursor-agent/server.js:153)

Example:

```json
{
  "name": "cursor_agent_chat",
  "arguments": { "prompt": "Explain SIMD in one paragraph", "output_format": "markdown" }
}
```


### 2) cursor_agent_edit_file

- Args: { file: string, instruction: string, apply?: boolean, dry_run?: boolean, prompt?: string, ...COMMON }
- Behavior: Prompt‑based wrapper. Builds a structured instruction that asks the agent to edit or propose a patch for the file.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:286)

Example:

```json
{
  "name": "cursor_agent_edit_file",
  "arguments": {
    "file": "src/app.ts",
    "instruction": "Extract the HTTP client into a separate module and add retries",
    "dry_run": true,
    "output_format": "markdown"
  }
}
```


### 3) cursor_agent_analyze_files

- Args: { paths: string | string[], prompt?: string, ...COMMON }
- Behavior: Prompt‑based repository/file analysis listing the paths to focus on.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:306)

Example:

```json
{
  "name": "cursor_agent_analyze_files",
  "arguments": {
    "paths": ["src", "scripts"],
    "prompt": "Give me a concise architecture overview with module boundaries"
  }
}
```


### 4) cursor_agent_search_repo

- Args: { query: string, include?: string | string[], exclude?: string | string[], ...COMMON }
- Behavior: Prompt‑based code search over the repo, with optional include/exclude globs.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:325)

Example:

```json
{
  "name": "cursor_agent_search_repo",
  "arguments": {
    "query": "fetch(",
    "include": ["src/**/*.ts", "app/**/*.tsx"],
    "exclude": ["node_modules/**", "dist/**"],
    "output_format": "markdown",
    "echo_prompt": true
  }
}
```


### 5) cursor_agent_plan_task

- Args: { goal: string, constraints?: string[], ...COMMON }
- Behavior: Prompt‑based planning tool that returns a numbered plan for your goal.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:347)

Example:

```json
{
  "name": "cursor_agent_plan_task",
  "arguments": {
    "goal": "Set up CI to lint and test this repo",
    "constraints": ["GitHub Actions", "Node 18"]
  }
}
```


### 6) cursor_agent_raw

- Args: { argv: string[], print?: boolean, ...COMMON }
- Behavior: Forwards raw argv to the CLI. Defaults to print=false to avoid adding --print; set print=true to inject it.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:369)

Examples:

```json
{ "name": "cursor_agent_raw", "arguments": { "argv": ["--help"], "print": false } }
```

```json
{ "name": "cursor_agent_raw", "arguments": { "argv": ["-m","gpt-5","What is SIMD?"], "print": true } }
```


### 7) cursor_agent_run (legacy)

- Args: { prompt: string, ...COMMON }
- Behavior: Original single‑shot chat wrapper; maintained for compatibility.
- Code path: [JavaScript.server.tool()](mcp-cursor-agent/server.js:385)


## Configuration for MCP hosts

Example Claude Code/Claude Desktop entry:

```json
{
  "mcpServers": {
    "cursor-agent": {
      "command": "node",
      "args": ["/abs/path/to/mcp-cursor-agent/server.js"],
      "env": {
        "CURSOR_AGENT_ECHO_PROMPT": "1",
        "CURSOR_AGENT_FORCE": "true",
        "CURSOR_AGENT_PATH": "/home/you/.local/bin/cursor-agent",
        "CURSOR_AGENT_MODEL": "gpt-5",
        "CURSOR_AGENT_IDLE_EXIT_MS": "0",
        "CURSOR_AGENT_TIMEOUT_MS": "60000"
      }
    }
  }
}
```
### Optional: enable debug logs

Add `DEBUG_CURSOR_MCP=1` to print diagnostics to stderr (spawn argv, prompt preview, exit). Useful while integrating or troubleshooting.

```json
{
  "mcpServers": {
    "cursor-agent": {
      "command": "node",
      "args": ["/abs/path/to/mcp-cursor-agent/server.js"],
      "env": {
        "CURSOR_AGENT_ECHO_PROMPT": "1",
        "CURSOR_AGENT_FORCE": "true",
        "CURSOR_AGENT_PATH": "/home/you/.local/bin/cursor-agent",
        "CURSOR_AGENT_MODEL": "gpt-5",
        "CURSOR_AGENT_IDLE_EXIT_MS": "0",
        "CURSOR_AGENT_TIMEOUT_MS": "60000",
        "DEBUG_CURSOR_MCP": "1"
      }
    }
  }
}
```

Note: many hosts don’t display server stderr logs. To see the effective prompt in the UI, use `CURSOR_AGENT_ECHO_PROMPT=1` or pass `"echo_prompt": true` in tool arguments. Implementation points:
- debug spawn/exit logs: [JavaScript.invokeCursorAgent()](mcp-cursor-agent/server.js:73)
- prompt preview: [JavaScript.runCursorAgent()](mcp-cursor-agent/server.js:171)

Environment variables understood by the server:

- CURSOR_AGENT_PATH: absolute path to the `cursor-agent` binary; falls back to PATH
- CURSOR_AGENT_MODEL: default model (appended as `-m <model>` unless you already provided one)
- CURSOR_AGENT_FORCE: "true"/"1" to inject `-f` unless already present
- CURSOR_AGENT_TIMEOUT_MS: hard runtime ceiling (default 30000)
- CURSOR_AGENT_IDLE_EXIT_MS: idle‑kill threshold in ms; "0" disables idle kill (recommended)
- CURSOR_AGENT_ECHO_PROMPT: "1" to prepend the effective prompt to the tool’s result
- DEBUG_CURSOR_MCP: "1" to log spawn/exit diagnostics to stderr


## Usage inside Claude

- Call any of the tools described above; arguments map 1:1 to the JSON fields in “Tools” section.
- To see the exact prompt, either set CURSOR_AGENT_ECHO_PROMPT=1 globally or pass `"echo_prompt": true` in the tool call.
- For advanced use, prefer `cursor_agent_raw` for precise control of argv and print behavior.


## Troubleshooting

- “cursor-agent not found”
  - Set CURSOR_AGENT_PATH to the absolute path of the CLI or ensure it’s on PATH.
- “No prompt provided for print mode”
  - You called RAW with print=true but without a prompt. Either provide a prompt in argv or set print=false.
- Premature termination mid‑generation
  - Increase CURSOR_AGENT_TIMEOUT_MS, and keep CURSOR_AGENT_IDLE_EXIT_MS at "0".
- Empty tool output
  - Verify provider credentials and model name. Try `cursor_agent_raw` with `argv: ["--version"]` to confirm CLI health.


## Development

- Start the server directly:
  - `node ./mcp-cursor-agent/server.js`
- Smoke client:
  - `node ./mcp-cursor-agent/test_client.mjs "hello"`
  - `TEST_TOOL=cursor_agent_raw TEST_ARGV='["--help"]' node ./mcp-cursor-agent/test_client.mjs`
- Useful env while developing:
  - `DEBUG_CURSOR_MCP=1 CURSOR_AGENT_ECHO_PROMPT=1`

Key entry points:

- Executor: [JavaScript.invokeCursorAgent()](mcp-cursor-agent/server.js:38)
- Legacy runner: [JavaScript.runCursorAgent()](mcp-cursor-agent/server.js:153)
- Tool registrations start at: [JavaScript.server.tool()](mcp-cursor-agent/server.js:273)


## Security notes

- Child processes are spawned with `shell: false` to avoid shell injection and quoting issues.
- Inputs are validated with Zod; unknown types are rejected.
- Avoid logging secrets; DEBUG only prints argv and minimal env context.


## Versioning

Current server version: 1.1.0 (see [mcp-cursor-agent/package.json](mcp-cursor-agent/package.json))


## License

MIT (see [mcp-cursor-agent/package.json](mcp-cursor-agent/package.json))


## Acknowledgements

- MCP protocol and SDK by the Model Context Protocol team
- Inspiration: multi‑verb MCP servers such as gemini‑mcp‑tool
