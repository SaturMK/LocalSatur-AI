const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const extensionConfig = {
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	};

	// Webview bundle: Markdown renderer exposed as `localforgeMarkdown`.
	const webviewConfig = {
		entryPoints: [
			'src/webview/markdown.ts'
		],
		bundle: true,
		format: 'iife',
		globalName: 'localforgeMarkdown',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview-markdown.js',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	};

	const contexts = await Promise.all([
		esbuild.context(extensionConfig),
		esbuild.context(webviewConfig),
	]);

	if (watch) {
		await Promise.all(contexts.map(context => context.watch()));
	} else {
		await Promise.all(contexts.map(context => context.rebuild()));
		await Promise.all(contexts.map(context => context.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
