import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function parseListEnv(name) {
  const v = process.env[name];
  if (!v) return undefined;
  try {
    // Allow JSON array in env
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  // Fallback: comma-separated list
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['./server.js'],
    cwd: new URL('.', import.meta.url).pathname.replace(/test_client\.mjs$/, ''),
    // inherit PATH so cursor-agent can be found; override via env if needed
    env: { ...process.env, CURSOR_AGENT_TIMEOUT_MS: process.env.CURSOR_AGENT_TIMEOUT_MS ?? '8000' },
  });

  const client = new Client({
    name: 'cursor-agent-e2e-test',
    version: '0.0.1',
  });

  await client.connect(transport);

  const tools = await client.listTools({});
  const names = tools.tools.map(t => t.name);
  console.log('Tools:', names.join(', '));

  // Default user prompt and extra CLI passthrough args
  const [promptDefault = 'hello from MCP smoke test', ...extraArgs] = process.argv.slice(2);

  const preferred = process.env.TEST_TOOL;
  const toolName = preferred && names.includes(preferred)
    ? preferred
    : 'cursor_agent_chat';

  console.log('Using tool:', toolName);

  let args;
  switch (toolName) {
    case 'cursor_agent_chat':
      args = {
        prompt: process.env.TEST_PROMPT || promptDefault,
        output_format: process.env.TEST_FORMAT || 'text',
        extra_args: extraArgs,
        ...(process.env.TEST_CWD ? { cwd: process.env.TEST_CWD } : {}),
      };
      break;


    case 'cursor_agent_edit_file':
      args = {
        file: process.env.TEST_FILE || 'README.md',
        instruction: process.env.TEST_INSTRUCTION || 'Summarize the file and suggest one improvement.',
        apply: process.env.TEST_APPLY === '1',
        dry_run: process.env.TEST_DRY_RUN === '1',
        prompt: process.env.TEST_PROMPT,
        output_format: process.env.TEST_FORMAT || 'text',
        extra_args: extraArgs,
        ...(process.env.TEST_CWD ? { cwd: process.env.TEST_CWD } : {}),
      };
      break;

    case 'cursor_agent_analyze_files': {
      const paths = parseListEnv('TEST_PATHS') || ['.'];
      args = {
        paths,
        prompt: process.env.TEST_PROMPT || 'Provide a brief analysis of these paths.',
        output_format: process.env.TEST_FORMAT || 'text',
        extra_args: extraArgs,
        ...(process.env.TEST_CWD ? { cwd: process.env.TEST_CWD } : {}),
      };
      break;
    }

    case 'cursor_agent_search_repo': {
      args = {
        query: process.env.TEST_QUERY || 'TODO',
        include: parseListEnv('TEST_INCLUDE'),
        exclude: parseListEnv('TEST_EXCLUDE'),
        output_format: process.env.TEST_FORMAT || 'text',
        extra_args: extraArgs,
        ...(process.env.TEST_CWD ? { cwd: process.env.TEST_CWD } : {}),
      };
      break;
    }

    case 'cursor_agent_plan_task':
      args = {
        goal: process.env.TEST_GOAL || 'Set up CI to lint and test this repo.',
        constraints: parseListEnv('TEST_CONSTRAINTS'),
        output_format: process.env.TEST_FORMAT || 'text',
        extra_args: extraArgs,
        ...(process.env.TEST_CWD ? { cwd: process.env.TEST_CWD } : {}),
      };
      break;

    case 'cursor_agent_raw': {
      const rawArgv = process.env.TEST_ARGV ? JSON.parse(process.env.TEST_ARGV) : ['--help'];
      const print = process.env.TEST_PRINT === '1';
      args = {
        argv: rawArgv,
        print,
        output_format: process.env.TEST_FORMAT || 'text',
        ...(process.env.TEST_CWD ? { cwd: process.env.TEST_CWD } : {}),
      };
      break;
    }

    default:
      throw new Error(`Unknown test tool ${toolName}`);
  }

  const call = client.callTool({
    name: toolName,
    arguments: args,
  });

  const callTimeout = Number.parseInt(process.env.TEST_TIMEOUT_MS || '90000', 10);
  const result = await Promise.race([
    call,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`tool call timeout after ${callTimeout}ms`)), callTimeout)),
  ]);

  if (result && result.content) {
    const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    console.log('Tool call output (first 500 chars):');
    console.log(text.slice(0, 500));
  }

  await client.close();
}

main().catch((e) => {
  console.error('E2E test failed:', e);
  process.exit(1);
});
