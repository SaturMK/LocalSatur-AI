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

