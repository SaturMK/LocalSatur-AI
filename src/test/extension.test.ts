import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { OllamaClient } from '../ollama/client';
import { OpenAICompatibleProvider } from '../providers/openai-compatible-provider';
import { TerminalTools } from '../tools/terminal';
import { AgentEngine } from '../agent/engine';
import { AIProviderManager } from '../providers/manager';
import { ToolManager } from '../agent/tools';
import { WorkspaceTools } from '../tools/workspace';
import { VSCodeContextTools } from '../tools/vscode-context';
import { renderMarkdown } from '../webview/markdown';
import { extractPlan } from '../agent/plan';
import { recordChangedFile, isChangedFileEntry } from '../agent/changed-files';
import { sanitizeSessions, sessionTitleFromMessage, summarizeSessions, MAX_SESSIONS } from '../agent/sessions';
import { McpClient } from '../mcp/client';
import { mcpToolName, isMcpToolName } from '../mcp/manager';
import { extractThinking, createThinkingFilter } from '../agent/thinking';
import { parseOpencodeModels, buildOpencodePrompt } from '../providers/opencode-provider';
import { AIProvider, AIChatOptions, AIChunkHandler, AIModel, AIResponse } from '../providers/types';
import { ChatMessage } from '../ollama/client';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('OpenAI-compatible provider resolves the configured API key', async () => {
		const config = vscode.workspace.getConfiguration('localforge.providers.openrouter');
		const target = vscode.ConfigurationTarget.Global;

		await config.update('apiKey', 'test-key-123', target);

		try {
			const provider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1',
				apiKeySetting: 'localforge.providers.openrouter.apiKey'
			});

			assert.strictEqual(await provider.getResolvedApiKey(), 'test-key-123');
		} finally {
			await config.update('apiKey', '', target);
		}
	});

	test('OpenAI-compatible provider reports model tool support', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(JSON.stringify({
			data: [
				{ id: 'tool-model', supported_parameters: ['tools', 'temperature'] },
				{ id: 'chat-model', supported_parameters: ['temperature'] }
			]
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});

		try {
			const provider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});
			const models = await provider.getModels();

			assert.strictEqual(models[0].capabilities?.includes('tools'), true);
			assert.strictEqual(models[1].capabilities?.includes('tools'), false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('OpenAI-compatible provider honors the supportsTools override (audit F3)', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => new Response(JSON.stringify({
			data: [{ id: 'unknown-model' }]
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});

		const config = vscode.workspace.getConfiguration('localforge.providers.openrouter');
		const original = config.inspect<boolean>('supportsTools')?.globalValue;

		try {
			await config.update('supportsTools', true, vscode.ConfigurationTarget.Global);
			const forcedProvider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});
			const forced = await forcedProvider.getModels();
			assert.deepStrictEqual(forced[0].capabilities, ['tools']);

			await config.update('supportsTools', false, vscode.ConfigurationTarget.Global);
			const disabledProvider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});
			const disabled = await disabledProvider.getModels();
			assert.deepStrictEqual(disabled[0].capabilities, []);

			// Unset: capability stays unknown instead of being disabled.
			await config.update('supportsTools', undefined, vscode.ConfigurationTarget.Global);
			const unsetProvider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});
			const unset = await unsetProvider.getModels();
			assert.strictEqual(unset[0].capabilities, undefined);
		} finally {
			await config.update('supportsTools', original, vscode.ConfigurationTarget.Global);
			globalThis.fetch = originalFetch;
		}
	});

	test('Edit proposals back up files outside the workspace (audit S5)', async () => {
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-s5-workspace-'));
		const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-s5-backups-'));

		fs.writeFileSync(path.join(workspaceRoot, 'app.txt'), 'original content', 'utf8');

		const workspaceTools = new WorkspaceTools(workspaceRoot);
		const vscodeContext = new VSCodeContextTools(workspaceRoot);
		const toolManager = new ToolManager(workspaceTools, vscodeContext, backupDirectory);

		try {
			const proposalResult = JSON.parse(await toolManager.execute('propose_file_edit', {
				path: 'app.txt',
				content: 'new content',
				reason: 'S5 backup regression test'
			})) as { proposalId: string };

			await toolManager.applyProposal(proposalResult.proposalId);

			// The current content must be backed up into extension storage...
			const backups = fs.readdirSync(backupDirectory);
			assert.strictEqual(backups.length, 1, 'expected exactly one backup in the storage directory');
			assert.ok(backups[0].startsWith('app.txt.localforge-backup-'), `unexpected backup name: ${backups[0]}`);
			assert.strictEqual(
				fs.readFileSync(path.join(backupDirectory, backups[0]), 'utf8'),
				'original content'
			);

			// ...and never beside the original file inside the workspace.
			assert.deepStrictEqual(fs.readdirSync(workspaceRoot), ['app.txt']);
			assert.strictEqual(fs.readFileSync(path.join(workspaceRoot, 'app.txt'), 'utf8'), 'new content');
		} finally {
			vscodeContext.dispose();
			fs.rmSync(workspaceRoot, { recursive: true, force: true });
			fs.rmSync(backupDirectory, { recursive: true, force: true });
		}
	});

	test('Markdown renderer escapes HTML injection before applying markup', async () => {
				const output = renderMarkdown('<script>alert(1)</script> and <img src=x onerror=alert(2)>');

		assert.ok(!output.includes('<script'), 'script tag must not survive rendering');
		assert.ok(!output.includes('<img'), 'img tag must not survive rendering');
		assert.ok(output.includes('&lt;script&gt;'));
	});

	test('Markdown renderer supports headings, emphasis, lists and code blocks', async () => {
				const output = renderMarkdown(
			'## Title\n\n**bold** and *italic* and `code`\n\n- one\n- two\n\n1. first\n2. second\n\n```ts\nconst x = 1;\n```'
		);

		assert.ok(output.includes('<h2>Title</h2>'));
		assert.ok(output.includes('<strong>bold</strong>'));
		assert.ok(output.includes('<em>italic</em>'));
		assert.ok(output.includes('<code class="inline-code">code</code>'));
		assert.ok(output.includes('<ul><li>one</li><li>two</li></ul>'));
		assert.ok(output.includes('<ol><li>first</li><li>second</li></ol>'));
		assert.ok(output.includes('data-language="ts"'));
		assert.ok(output.includes('const x = 1;'));
	});

	test('Markdown renderer allows only safe link schemes', async () => {
				const safe = renderMarkdown('[site](https://example.com)');
		assert.ok(safe.includes('href="https://example.com"'));

		const dangerous = renderMarkdown('[x](javascript:alert(1)) and [y](file:///etc/passwd)');
		assert.ok(!dangerous.includes('href="javascript:'));
		assert.ok(!dangerous.includes('href="file:'));
	});

	test('Markdown renderer closes unterminated code fences (streaming)', async () => {
				const output = renderMarkdown('text before\n\n```python\nprint("hi")');

		assert.ok(output.includes('data-language="python"'));
		assert.ok(output.includes('print(&quot;hi&quot;)'));
		// No unbalanced markup: the fence is closed implicitly at EOF.
		assert.strictEqual(output.split('<pre').length, output.split('</pre>').length);
	});

	test('Plan mode extracts structured plan entities from the plan block', async () => {
				const response = [
			'## Approach',
			'',
			'We will refactor the provider layer.',
			'',
			'```localforge-plan',
			JSON.stringify({
				summary: 'Refactor provider layer',
				steps: [
					{ title: 'Split provider interface', files: ['src/providers/types.ts'], action: 'edit' },
					{ title: 'Add unit tests', files: ['src/test/providers.test.ts'], action: 'create' }
				],
				risks: ['Breaking change for custom providers']
			}),
			'```'
		].join('\n');

		const result = extractPlan(response);

		assert.ok(result.plan, 'valid plan block must produce a plan');
		assert.strictEqual(result.plan.summary, 'Refactor provider layer');
		assert.strictEqual(result.plan.steps.length, 2);
		assert.strictEqual(result.plan.steps[0].action, 'edit');
		assert.deepStrictEqual(result.plan.steps[0].files, ['src/providers/types.ts']);
		assert.deepStrictEqual(result.plan.risks, ['Breaking change for custom providers']);

		// The block is stripped from the displayed content.
		assert.ok(!result.content.includes('localforge-plan'));
		assert.ok(result.content.includes('## Approach'));
	});

	test('Plan mode leaves malformed or missing plan blocks untouched', async () => {
				// No block at all.
		const noBlock = extractPlan('Just a plain answer.');
		assert.strictEqual(noBlock.content, 'Just a plain answer.');
		assert.strictEqual(noBlock.plan, undefined);

		// Malformed JSON: content unchanged so the user sees what the model wrote.
		const malformed = extractPlan('Plan:\n```localforge-plan\n{not json}\n```');
		assert.ok(malformed.content.includes('{not json}'));
		assert.strictEqual(malformed.plan, undefined);

		// Steps missing or empty: no plan entity.
		const emptySteps = extractPlan('Plan:\n```localforge-plan\n{"summary":"x","steps":[]}\n```');
		assert.strictEqual(emptySteps.plan, undefined);

		// Invalid action values normalize to "other"; untitled steps are dropped.
		const normalized = extractPlan(
			'```localforge-plan\n{"steps":[{"title":"a","action":"explode"},{"files":["b"]},{"title":"c","action":"verify"}]}\n```'
		);
		assert.ok(normalized.plan);
		assert.strictEqual(normalized.plan.steps.length, 2);
		assert.strictEqual(normalized.plan.steps[0].action, 'other');
		assert.strictEqual(normalized.plan.steps[1].action, 'verify');
	});

	test('Changed-file tracking dedupes by current path and validates entries', async () => {
				let list = recordChangedFile([], {
			path: 'src/a.ts',
			operation: 'edit',
			timestamp: 1000
		});

		list = recordChangedFile(list, {
			path: 'src/a.ts',
			operation: 'edit',
			timestamp: 2000
		});

		list = recordChangedFile(list, {
			path: 'src/a.ts',
			targetPath: 'src/b.ts',
			operation: 'rename',
			timestamp: 3000
		});

		// Repeated edits collapse; the rename is keyed by its target path.
		assert.strictEqual(list.length, 1);
		assert.strictEqual(list[0].operation, 'rename');
		assert.strictEqual(list[0].targetPath, 'src/b.ts');

		list = recordChangedFile(list, {
			path: 'src/c.ts',
			operation: 'create',
			timestamp: 4000
		});
		assert.strictEqual(list.length, 2);

		// A later edit of the renamed file replaces the rename entry.
		list = recordChangedFile(list, {
			path: 'src/b.ts',
			operation: 'edit',
			timestamp: 5000
		});
		assert.strictEqual(list.length, 2);
		assert.ok(list.some(entry => entry.path === 'src/b.ts' && entry.operation === 'edit'));

		assert.strictEqual(isChangedFileEntry({ path: 'x', operation: 'edit', timestamp: 1 }), true);
		assert.strictEqual(isChangedFileEntry({ path: 'x', operation: 'bogus', timestamp: 1 }), false);
		assert.strictEqual(isChangedFileEntry({ operation: 'edit', timestamp: 1 }), false);
		assert.strictEqual(isChangedFileEntry(null), false);
	});

	test('Session store sanitizes persisted data and derives titles', async () => {
				const now = Date.now();

		const valid = {
			id: 's1',
			title: 'Refactor',
			createdAt: now,
			updatedAt: now,
			messages: [
				{ role: 'user', content: 'Refactor the provider layer' },
				{ role: 'assistant', content: 'Here is my plan' },
				{ role: 'bogus', content: 'dropped' },
				{ role: 'user' }
			],
			changedFiles: [
				{ path: 'src/a.ts', operation: 'edit', timestamp: now },
				{ path: 42, operation: 'edit', timestamp: now }
			]
		};

		const malformed = { id: 7, title: 'nope' };
		const notAnObject = 'garbage';

		const sessions = sanitizeSessions([valid, malformed, notAnObject]);

		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0].id, 's1');
		assert.strictEqual(sessions[0].messages.length, 2, 'invalid messages are dropped');
		assert.strictEqual(sessions[0].changedFiles.length, 1, 'invalid changed-file entries are dropped');

		assert.strictEqual(sanitizeSessions('nope').length, 0);
		assert.strictEqual(sanitizeSessions(null).length, 0);

		// Cap: oldest sessions are dropped beyond MAX_SESSIONS.
		const tooMany = Array.from({ length: MAX_SESSIONS + 5 }, (_v, index) => ({
			id: 's' + index,
			title: 't' + index,
			createdAt: now + index,
			updatedAt: now + index,
			messages: [],
			changedFiles: []
		}));
		assert.strictEqual(sanitizeSessions(tooMany).length, MAX_SESSIONS);
		assert.strictEqual(sanitizeSessions(tooMany)[0].id, 's5', 'oldest sessions are dropped');

		// Titles: first line, whitespace-collapsed, truncated at 48 chars.
		assert.strictEqual(sessionTitleFromMessage('Fix the bug\n\nin parser'), 'Fix the bug');
		assert.strictEqual(sessionTitleFromMessage('   \n  '), 'New session');
		const long = 'x'.repeat(60);
		const titled = sessionTitleFromMessage(long);
		assert.ok(titled.length <= 49);
		assert.ok(titled.endsWith('…'));

		// Summaries: most recently updated first, active flagged.
		const summaries = summarizeSessions(
			[
				{ id: 'old', title: 'Old', createdAt: now, updatedAt: now, messages: [], changedFiles: [] },
				{ id: 'new', title: 'New', createdAt: now, updatedAt: now + 1000, messages: [{ role: 'user', content: 'hi' }], changedFiles: [{ path: 'p', operation: 'edit', timestamp: now }] }
			],
			'old'
		);
		assert.strictEqual(summaries[0].id, 'new');
		assert.strictEqual(summaries[1].id, 'old');
		assert.strictEqual(summaries[1].active, true);
		assert.strictEqual(summaries[1].active === summaries[0].active, false);
	});

	test('MCP client performs handshake, tool discovery and tool calls over stdio', async function () {
		// The extension host strips timeouts from mocha; keep the default.
		this.timeout(30000);

		/*
		 * A minimal MCP stdio server: responds to initialize,
		 * notifications/initialized, tools/list and tools/call with
		 * newline-delimited JSON-RPC.
		 */
		const serverScript = [
			'const readline = require("readline");',
			'const rl = readline.createInterface({ input: process.stdin });',
			'rl.on("line", line => {',
			'  let message;',
			'  try { message = JSON.parse(line); } catch { return; }',
			'  if (message.method === "initialize") {',
			'    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1.0" } } }) + "\\n");',
			'    return;',
			'  }',
			'  if (message.method === "notifications/initialized") { return; }',
			'  if (message.method === "tools/list") {',
			'    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [ { name: "echo", description: "Echo the input", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } ] } }) + "\\n");',
			'    return;',
			'  }',
			'  if (message.method === "tools/call") {',
			'    const text = "echo: " + String(message.params.arguments.text);',
			'    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [ { type: "text", text } ], isError: false } }) + "\\n");',
			'    return;',
			'  }',
			'  if (message.id !== undefined) {',
			'    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } }) + "\\n");',
			'  }',
			'});'
		].join('\n');

		const client = new McpClient('test', {
			command: process.execPath,
			args: ['-e', serverScript]
		});

		try {
			await client.ensureStarted(10000);

			const tools = await client.listTools(10000);
			assert.strictEqual(tools.length, 1);
			assert.strictEqual(tools[0].name, 'echo');
			assert.strictEqual(tools[0].description, 'Echo the input');

			const call = await client.callTool('echo', { text: 'hello' }, 10000);
			assert.strictEqual(call.isError, false);
			assert.strictEqual(call.text, 'echo: hello');
		} finally {
			client.dispose();
		}
	});

	test('MCP tool names are namespaced and sanitized', () => {
		assert.strictEqual(mcpToolName('filesystem', 'read_file'), 'mcp__filesystem__read_file');
		assert.strictEqual(mcpToolName('my server.v2', 'do thing'), 'mcp__my_server_v2__do_thing');
		assert.strictEqual(isMcpToolName('mcp__filesystem__read_file'), true);
		assert.strictEqual(isMcpToolName('read_file'), false);
	});

	test('extractThinking strips reasoning tags from complete responses', () => {
		// No tags: unchanged.
		assert.strictEqual(extractThinking('plain answer').content, 'plain answer');
		assert.strictEqual(extractThinking('plain answer').thinking, undefined);

		// Paired tags: reasoning removed, content kept.
		const paired = extractThinking('<think>hmm, let me look</think>The answer is 4.');
		assert.strictEqual(paired.content, 'The answer is 4.');
		assert.strictEqual(paired.thinking, 'hmm, let me look');

		// Unclosed tag: everything after <think> is reasoning.
		const unclosed = extractThinking('Sure. <think>never finished');
		assert.strictEqual(unclosed.content, 'Sure. ');
		assert.strictEqual(unclosed.thinking, 'never finished');

		// Content before the tag is preserved.
		const prefix = extractThinking('Intro\n<think>x</think>Body');
		assert.strictEqual(prefix.content, 'Intro\nBody');
	});

	test('createThinkingFilter catches reasoning tags split across stream chunks', () => {
		const filter = createThinkingFilter();
		let emitted = '';
		const push = (chunk: string) => { emitted += filter.push(chunk).content; };

		// Tag split across every boundary.
		push('<th');
		push('ink>secret chain');
		push(' of thought</th');
		push('ink>');
		push('The real answer.');
		push(' Done.');
		push('</think>');
		push(' tail');
		emitted += filter.flush().content;

		assert.strictEqual(emitted, 'The real answer. Done. tail');
	});

	test('OpenCode CLI provider helpers parse models and build prompts', () => {
		// Model listing: plain provider/model lines, junk ignored.
		const parsed = parseOpencodeModels([
			'opencode/glm-5.3-flash-free',
			'',
			'ollama/qwen3:8b-16k',
			'not a model line',
			'opencode/glm-5.3-flash-free',
			'usage notes below'
		].join('\n'));
		assert.deepStrictEqual(parsed, ['ollama/qwen3:8b-16k', 'opencode/glm-5.3-flash-free']);

		// Prompt serialization: roles labeled, tool history skipped.
		const prompt = buildOpencodePrompt([
			{ role: 'system', content: 'Be helpful.' },
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'hello' },
			{ role: 'tool', content: 'tool output' },
			{ role: 'user', content: 'continue' }
		] as never);

		assert.ok(prompt.includes('[Instructions]\nBe helpful.'));
		assert.ok(prompt.includes('[User]\nhi'));
		assert.ok(prompt.includes('[Assistant]\nhello'));
		assert.ok(!prompt.includes('tool output'));
		assert.ok(prompt.includes('[User]\ncontinue'));
		assert.ok(prompt.includes('Reply with the assistant'));
	});

	test('createThinkingFilter flushes plain held text and unclosed reasoning', () => {
		// Plain text held back across the boundary is released by flush().
		const plain = createThinkingFilter();
		let plainOut = '';
		plainOut += plain.push('hello <b>world').content;
		plainOut += plain.flush().content;
		assert.strictEqual(plainOut, 'hello <b>world');

		// Unclosed <think> at end of stream: nothing leaks as content.
		const unclosed = createThinkingFilter();
		let unclosedOut = '';
		let thinkingOut = '';
		const unclosedPush = unclosed.push('Answer. <think>still thinking');
		unclosedOut += unclosedPush.content;
		if (unclosedPush.thinking) { thinkingOut += unclosedPush.thinking; }
		const flushed = unclosed.flush();
		unclosedOut += flushed.content;
		if (flushed.thinking) { thinkingOut += flushed.thinking; }
		assert.strictEqual(unclosedOut, 'Answer. ');
		assert.strictEqual(thinkingOut, 'still thinking');
	});

	test('OpenAI-compatible provider uses the configured output token limit', async () => {
		const originalFetch = globalThis.fetch;
		let requestBody: Record<string, unknown> | undefined;
		globalThis.fetch = async (_input, init) => {
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(JSON.stringify({
				model: 'test-model',
				choices: [{ message: { content: 'draft' } }]
			}), { status: 200 });
		};

		try {
			const provider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});
			await provider.chat('test-model', [], {
				contextLength: 16384,
				maxOutputTokens: 8192
			});

			assert.strictEqual(requestBody?.max_tokens, 8192);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('OpenAI-compatible provider preserves tool call IDs and cancellation signals', async () => {
		const originalFetch = globalThis.fetch;
		const controller = new AbortController();
		let receivedSignal: AbortSignal | undefined;
		globalThis.fetch = async (_input, init) => {
			receivedSignal = init?.signal ?? undefined;
			return new Response(JSON.stringify({
				model: 'test-model',
				choices: [{ message: {
					content: '',
					tool_calls: [{
						id: 'call_123',
						type: 'function',
						function: { name: 'read_file', arguments: '{"path":"README.md"}' }
					}]
				} }]
			}), { status: 200 });
		};

		try {
			const provider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});
			const result = await provider.chat('test-model', [], { signal: controller.signal });

			assert.strictEqual(receivedSignal, controller.signal);
			assert.strictEqual(result.toolCalls?.[0].id, 'call_123');
			assert.deepStrictEqual(result.toolCalls?.[0].function.arguments, { path: 'README.md' });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('Ollama client uses the configured output token limit', async () => {
		const originalFetch = globalThis.fetch;
		let requestBody: { options?: { num_predict?: number } } | undefined;
		globalThis.fetch = async (_input, init) => {
			requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
			return new Response(JSON.stringify({
				model: 'test-model',
				message: { role: 'assistant', content: 'draft' },
				done: true
			}), { status: 200 });
		};

		try {
			const client = new OllamaClient('http://localhost:11434');
			await client.chat('test-model', [], undefined, 4096);

			assert.strictEqual(requestBody?.options?.num_predict, 4096);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('Terminal tools stream output only for approved commands', async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
		const terminal = new TerminalTools(workspaceRoot);
		const chunks: string[] = [];
		const result = await terminal.runCommand('node --version', undefined, (_stream, chunk) => {
			chunks.push(chunk);
		});

		assert.strictEqual(result.success, true);
		assert.ok(chunks.join('').includes('v'));
		await assert.rejects(
			() => terminal.runCommand('node -e "process.exit(0)"'),
			/Command is not allowed/
		);
	});

	test('Agent engine preserves assistant tool calls between iterations (audit F1)', async () => {
		const configuration = vscode.workspace.getConfiguration('localforge');
		const originalProvider = configuration.get<string>('provider', 'ollama');
		await configuration.update('provider', 'stub-tools', vscode.ConfigurationTarget.Global);

		let callCount = 0;
		let secondIterationMessages: ChatMessage[] = [];

		const stubProvider: AIProvider = {
			id: 'stub-tools',
			name: 'Stub Tools',
			isAvailable: async () => true,
			getModels: async () => [{
				id: 'stub-model',
				name: 'stub-model',
				provider: 'stub-tools',
				capabilities: ['tools']
			}],
			chat: async () => {
				throw new Error('not used');
			},
			streamChat: async (
				_model: string,
				messages: ChatMessage[],
				_onChunk: AIChunkHandler,
				_options?: AIChatOptions
			): Promise<AIResponse> => {
				callCount++;

				if (callCount === 1) {
					return {
						model: 'stub-model',
						// Empty content with a tool call: the F1 regression case.
						content: '',
						toolCalls: [{
							id: 'call_f1',
							type: 'function',
							function: {
								name: 'get_active_editor',
								arguments: {}
							}
						}],
						done: true
					};
				}

				secondIterationMessages = messages;

				return {
					model: 'stub-model',
					content: 'done',
					done: true
				};
			}
		};

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
		const workspaceTools = new WorkspaceTools(workspaceRoot);
		const vscodeContext = new VSCodeContextTools(workspaceRoot);
		const toolManager = new ToolManager(workspaceTools, vscodeContext);
		const providerManager = new AIProviderManager([stubProvider]);
		const engine = new AgentEngine(
			new OllamaClient('http://localhost:11434'),
			toolManager,
			providerManager
		);

		try {
			const result = await engine.run('run the stub tool');

			assert.strictEqual(result.content, 'done');
			assert.strictEqual(callCount, 2);

			// The second iteration must contain the assistant message that
			// carries the tool call, even though its content was empty.
			const assistantToolCallMessage = secondIterationMessages.find(
				message =>
					message.role === 'assistant' &&
					Array.isArray(message.tool_calls) &&
					message.tool_calls.length > 0
			);

			assert.ok(assistantToolCallMessage, 'assistant tool_calls message was dropped from the transcript');
			assert.strictEqual(assistantToolCallMessage.tool_calls?.[0]?.function.name, 'get_active_editor');
		} finally {
			vscodeContext.dispose();
			await configuration.update('provider', originalProvider, vscode.ConfigurationTarget.Global);
		}
	});

	test('OpenAI-compatible provider aggregates multi-line SSE data events (audit F2)', async () => {
		const originalFetch = globalThis.fetch;
		const sseBody = [
			'data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}',
			'',
			'data: {"model":"m","choices":[{"delta":{"content":"lo"}}]}',
			'',
			// One JSON payload deliberately split across two data lines.
			'data: {"model":"m","choices":[{"delta":{',
			'data: "content":"!"}}]}',
			'',
			'data: [DONE]',
			''
		].join('\n');

		globalThis.fetch = async () => new Response(sseBody, { status: 200 });

		try {
			const provider = new OpenAICompatibleProvider({
				id: 'openrouter',
				name: 'OpenRouter',
				baseUrl: 'https://openrouter.ai/api/v1'
			});

			const received: string[] = [];
			const result = await provider.streamChat('test-model', [], async chunk => {
				received.push(chunk);
			});

			assert.strictEqual(result.content, 'Hello!');
			assert.deepStrictEqual(received.join(''), 'Hello!');
			assert.strictEqual(result.done, true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});




