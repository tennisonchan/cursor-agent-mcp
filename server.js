// MCP wrapper server for cursor-agent CLI
// Exposes multiple tools (chat/edit/analyze/search/plan/raw + legacy run) for better discoverability.
// Start via MCP config (stdio). Requires Node 18+.

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';
import process from 'node:process';

// Tool input schema
const RUN_SCHEMA = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  output_format: z.enum(['text', 'json', 'markdown']).default('text'),
  extra_args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  // Optional override for the executable path if not on PATH
  executable: z.string().optional(),
  // Optional model and force for parity with other tools/env overrides
  model: z.string().optional(),
  force: z.boolean().optional(),
});

// Resolve the executable path for cursor-agent
function resolveExecutable(explicit) {
  if (explicit && explicit.trim()) return explicit.trim();
  if (process.env.CURSOR_AGENT_PATH && process.env.CURSOR_AGENT_PATH.trim()) {
    return process.env.CURSOR_AGENT_PATH.trim();
  }
  // default assumes "cursor-agent" is on PATH
  return 'cursor-agent';
}

/**
* Internal executor that spawns cursor-agent with provided argv and common options.
* Adds --print and --output-format, handles env/model/force, timeouts and idle kill.
*/
async function invokeCursorAgent({ argv, output_format = 'text', cwd, executable, model, force, print = true }) {
 const cmd = resolveExecutable(executable);

 // Compute model/force from args/env
 const userArgs = [...(argv ?? [])];
 const hasModelFlag = userArgs.some((a) => a === '-m' || a === '--model' || /^(?:-m=|--model=)/.test(String(a)));
 const envModel = process.env.CURSOR_AGENT_MODEL && process.env.CURSOR_AGENT_MODEL.trim();
 const effectiveModel = model?.trim?.() || envModel;

 const hasForceFlag = userArgs.some((a) => a === '-f' || a === '--force');
 const envForce = (() => {
   const v = (process.env.CURSOR_AGENT_FORCE || '').toLowerCase();
   return v === '1' || v === 'true' || v === 'yes' || v === 'on';
 })();
 const effectiveForce = typeof force === 'boolean' ? force : envForce;

 const finalArgv = [
   ...(print ? ['--print', '--output-format', output_format] : []),
   ...userArgs,
   ...(hasForceFlag || !effectiveForce ? [] : ['-f']),
   ...(hasModelFlag || !effectiveModel ? [] : ['-m', effectiveModel]),
 ];

 return new Promise((resolve) => {
   let settled = false;
   let out = '';
   let err = '';
   let idleTimer = null;
   let killedByIdle = false;

   const cleanup = () => {
     if (mainTimer) clearTimeout(mainTimer);
     if (idleTimer) clearTimeout(idleTimer);
   };

   if (process.env.DEBUG_CURSOR_MCP === '1') {
     try {
       console.error('[cursor-mcp] spawn:', cmd, ...finalArgv);
     } catch {}
   }

   const child = spawn(cmd, finalArgv, {
     shell: false, // safer across platforms; rely on PATH/PATHEXT
     cwd: cwd || process.cwd(),
     env: process.env,
   });
   try { child.stdin?.end(); } catch {}

   const idleMs = Number.parseInt(process.env.CURSOR_AGENT_IDLE_EXIT_MS || '0', 10);
   const scheduleIdleKill = () => {
     if (!Number.isFinite(idleMs) || idleMs <= 0) return;
     if (idleTimer) clearTimeout(idleTimer);
     idleTimer = setTimeout(() => {
       killedByIdle = true;
       try { child.kill('SIGKILL'); } catch {}
     }, idleMs);
   };

   child.stdout.on('data', (d) => {
     out += d.toString();
     scheduleIdleKill();
   });

   child.stderr.on('data', (d) => {
     err += d.toString();
   });

   child.on('error', (e) => {
     if (settled) return;
     settled = true;
     cleanup();
     if (process.env.DEBUG_CURSOR_MCP === '1') {
       try { console.error('[cursor-mcp] error:', e); } catch {}
     }
     const msg =
       `Failed to start "${cmd}": ${e?.message || e}\n` +
       `Args: ${JSON.stringify(finalArgv)}\n` +
       (process.env.CURSOR_AGENT_PATH ? `CURSOR_AGENT_PATH=${process.env.CURSOR_AGENT_PATH}\n` : '');
     resolve({ content: [{ type: 'text', text: msg }], isError: true });
   });

   const defaultTimeout = 30000;
   const timeoutMs = Number.parseInt(process.env.CURSOR_AGENT_TIMEOUT_MS || String(defaultTimeout), 10);
   const mainTimer = setTimeout(() => {
     try { child.kill('SIGKILL'); } catch {}
     if (settled) return;
     settled = true;
     cleanup();
     resolve({
       content: [{ type: 'text', text: `cursor-agent timed out after ${Number.isFinite(timeoutMs) ? timeoutMs : defaultTimeout}ms` }],
       isError: true,
     });
   }, Number.isFinite(timeoutMs) ? timeoutMs : defaultTimeout);

   child.on('close', (code) => {
     if (settled) return;
     settled = true;
     cleanup();
     if (process.env.DEBUG_CURSOR_MCP === '1') {
       try { console.error('[cursor-mcp] exit:', code, 'stdout bytes=', out.length, 'stderr bytes=', err.length); } catch {}
     }
     if (code === 0 || (killedByIdle && out)) {
       resolve({ content: [{ type: 'text', text: out || '(no output)' }] });
     } else {
       resolve({
         content: [{ type: 'text', text: `cursor-agent exited with code ${code}\n${err || out || '(no output)'}` }],
         isError: true,
       });
     }
   });
 });
}

// Back-compat: single-shot run by prompt as positional argument.
// Accepts either a flat args object or an object with an "arguments" field (some hosts).
async function runCursorAgent(input) {
  const source = (input && typeof input === 'object' && input.arguments && typeof input.prompt === 'undefined')
    ? input.arguments
    : input;

  const {
    prompt,
    output_format = 'text',
    extra_args,
    cwd,
    executable,
    model,
    force,
  } = source || {};

  const argv = [...(extra_args ?? []), String(prompt)];
  const usedPrompt = argv.length ? String(argv[argv.length - 1]) : '';
 
  // Optional prompt echo and debug diagnostics
  if (process.env.DEBUG_CURSOR_MCP === '1') {
    try {
      const preview = usedPrompt.slice(0, 400).replace(/\n/g, '\\n');
      console.error('[cursor-mcp] prompt:', preview);
      if (extra_args?.length) console.error('[cursor-mcp] extra_args:', JSON.stringify(extra_args));
      if (model) console.error('[cursor-mcp] model:', model);
      if (typeof force === 'boolean') console.error('[cursor-mcp] force:', String(force));
    } catch {}
  }
 
  const result = await invokeCursorAgent({ argv, output_format, cwd, executable, model, force });
 
  // Echo prompt either when env is set or when caller provided echo_prompt: true (if host forwards unknown args it's fine)
  const echoEnabled = process.env.CURSOR_AGENT_ECHO_PROMPT === '1' || source?.echo_prompt === true;
  if (echoEnabled) {
    const text = `Prompt used:\n${usedPrompt}`;
    const content = Array.isArray(result?.content) ? result.content : [];
    return { ...result, content: [{ type: 'text', text }, ...content] };
  }
 
  return result;
}

/**
* Create MCP server and register a suite of cursor-agent tools.
* We expose multiple verbs for better discoverability in hosts (chat/edit/analyze/search/plan),
* plus the legacy cursor_agent_run for back-compat and a raw escape hatch.
*/
const server = new McpServer(
 {
   name: 'cursor-agent',
   version: '1.1.0',
   description: 'MCP wrapper for cursor-agent CLI (multi-tool: chat/edit/analyze/search/plan/raw)',
 },
 {
   instructions:
     [
       'Tools:',
       '- cursor_agent_chat: chat with a prompt; optional model/force/format.',
       '- cursor_agent_edit_file: prompt-based file edit wrapper; you provide file and instruction.',
       '- cursor_agent_analyze_files: prompt-based analysis of one or more paths.',
       '- cursor_agent_search_repo: prompt-based code search with include/exclude globs.',
       '- cursor_agent_plan_task: prompt-based planning given a goal and optional constraints.',
       '- cursor_agent_raw: pass raw argv directly to cursor-agent; set print=false to avoid implicit --print.',
       '- cursor_agent_run: legacy single-shot chat (prompt as positional).',
     ].join(' '),
 },
);

// Common shape used by multiple schemas
const COMMON = {
 output_format: z.enum(['text', 'json', 'markdown']).default('text'),
 extra_args: z.array(z.string()).optional(),
 cwd: z.string().optional(),
 executable: z.string().optional(),
 model: z.string().optional(),
 force: z.boolean().optional(),
 // When true, the server will prepend the effective prompt to the tool output (useful for Claude debugging)
 echo_prompt: z.boolean().optional(),
};

// Schemas
const CHAT_SCHEMA = z.object({
 prompt: z.string().min(1, 'prompt is required'),
 ...COMMON,
});

const EDIT_FILE_SCHEMA = z.object({
 file: z.string().min(1, 'file is required'),
 instruction: z.string().min(1, 'instruction is required'),
 apply: z.boolean().optional(),
 dry_run: z.boolean().optional(),
 // optional free-form prompt to pass if the CLI supports one
 prompt: z.string().optional(),
 ...COMMON,
});

const ANALYZE_FILES_SCHEMA = z.object({
  paths: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  prompt: z.string().optional(),
  ...COMMON,
});

const SEARCH_REPO_SCHEMA = z.object({
  query: z.string().min(1, 'query is required'),
  include: z.union([z.string(), z.array(z.string())]).optional(),
  exclude: z.union([z.string(), z.array(z.string())]).optional(),
  ...COMMON,
});

const PLAN_TASK_SCHEMA = z.object({
 goal: z.string().min(1, 'goal is required'),
 constraints: z.array(z.string()).optional(),
 ...COMMON,
});

const RAW_SCHEMA = z.object({
  // raw argv to pass after common flags; e.g., ["--help"] or ["subcmd","--flag"]
  argv: z.array(z.string()).min(1, 'argv must contain at least one element'),
  print: z.boolean().optional(),
  ...COMMON,
});

// Tools
server.tool(
  'cursor_agent_chat',
  'Chat with cursor-agent using a prompt and optional model/force/output_format.',
  CHAT_SCHEMA.shape,
  async (args) => {
    try {
      // Normalize prompt in case the host nests under "arguments"
      const prompt =
        (args && typeof args === 'object' && 'prompt' in args ? args.prompt : undefined) ??
        (args && typeof args === 'object' && args.arguments && typeof args.arguments === 'object' ? args.arguments.prompt : undefined);

      const flat = {
        ...(args && typeof args === 'object' && args.arguments && typeof args.arguments === 'object' ? args.arguments : args),
        prompt,
      };

      return await runCursorAgent(flat);
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
    }
  },
);

server.tool(
  'cursor_agent_edit_file',
  'Edit a file with an instruction. Prompt-based wrapper; no CLI subcommand required.',
  EDIT_FILE_SCHEMA.shape,
  async (args) => {
    try {
      const { file, instruction, apply, dry_run, prompt, output_format, cwd, executable, model, force, extra_args } = args;
      const composedPrompt =
        `Edit the repository file:\n` +
        `- File: ${String(file)}\n` +
        `- Instruction: ${String(instruction)}\n` +
        (apply ? `- Apply changes if safe.\n` : `- Propose a patch/diff without applying.\n`) +
        (dry_run ? `- Treat as dry-run; do not write to disk.\n` : ``) +
        (prompt ? `- Additional context: ${String(prompt)}\n` : ``);
      return await runCursorAgent({ prompt: composedPrompt, output_format, extra_args, cwd, executable, model, force });
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
    }
  },
);

server.tool(
  'cursor_agent_analyze_files',
  'Analyze one or more paths; optional prompt. Prompt-based wrapper.',
  ANALYZE_FILES_SCHEMA.shape,
  async (args) => {
    try {
      const { paths, prompt, output_format, cwd, executable, model, force, extra_args } = args;
      const list = Array.isArray(paths) ? paths : [paths];
      const composedPrompt =
        `Analyze the following paths in the repository:\n` +
        list.map((p) => `- ${String(p)}`).join('\n') + '\n' +
        (prompt ? `Additional prompt: ${String(prompt)}\n` : '');
      return await runCursorAgent({ prompt: composedPrompt, output_format, extra_args, cwd, executable, model, force });
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
    }
  },
);

server.tool(
  'cursor_agent_search_repo',
  'Search repository code with include/exclude patterns. Prompt-based wrapper.',
  SEARCH_REPO_SCHEMA.shape,
  async (args) => {
    try {
      const { query, include, exclude, output_format, cwd, executable, model, force, extra_args } = args;
      const inc = include == null ? [] : (Array.isArray(include) ? include : [include]);
      const exc = exclude == null ? [] : (Array.isArray(exclude) ? exclude : [exclude]);
      const composedPrompt =
        `Search the repository for occurrences relevant to:\n` +
        `- Query: ${String(query)}\n` +
        (inc.length ? `- Include globs:\n${inc.map((p)=>`  - ${String(p)}`).join('\n')}\n` : '') +
        (exc.length ? `- Exclude globs:\n${exc.map((p)=>`  - ${String(p)}`).join('\n')}\n` : '') +
        `Return concise findings with file paths and line references.`;
      return await runCursorAgent({ prompt: composedPrompt, output_format, extra_args, cwd, executable, model, force });
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
    }
  },
);

server.tool(
  'cursor_agent_plan_task',
  'Generate a plan for a goal with optional constraints. Prompt-based wrapper.',
  PLAN_TASK_SCHEMA.shape,
  async (args) => {
    try {
      const { goal, constraints, output_format, cwd, executable, model, force, extra_args } = args;
      const cons = constraints ?? [];
      const composedPrompt =
        `Create a step-by-step plan to accomplish the following goal:\n` +
        `- Goal: ${String(goal)}\n` +
        (cons.length ? `- Constraints:\n${cons.map((c)=>`  - ${String(c)}`).join('\n')}\n` : '') +
        `Provide a numbered list of actions.`;
      return await runCursorAgent({ prompt: composedPrompt, output_format, extra_args, cwd, executable, model, force });
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
    }
  },
);

// Raw escape hatch for power-users and forward compatibility
server.tool(
 'cursor_agent_raw',
 'Advanced: provide raw argv array to pass after common flags (e.g., ["search","--query","foo"]).',
 RAW_SCHEMA.shape,
 async (args) => {
   try {
     const { argv, output_format, cwd, executable, model, force } = args;
     // For raw calls we disable implicit --print to allow commands like "--help"
     return await invokeCursorAgent({ argv, output_format, cwd, executable, model, force, print: false });
   } catch (e) {
     return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
   }
 },
);

// Legacy single-shot prompt tool retained for compatibility
server.tool(
 'cursor_agent_run',
 'Run cursor-agent with a prompt and desired output format (legacy single-shot).',
 RUN_SCHEMA.shape,
 async (args) => {
   try {
     return await runCursorAgent(args);
   } catch (e) {
     return { content: [{ type: 'text', text: `Invalid params: ${e?.message || e}` }], isError: true };
   }
 },
);

// Connect using stdio transport
const transport = new StdioServerTransport();

server.connect(transport).catch((e) => {
 console.error('MCP server failed to start:', e);
 process.exit(1);
});