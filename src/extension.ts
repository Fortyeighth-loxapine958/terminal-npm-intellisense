import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

const scriptsCache = new Map<string, Record<string, string>>();
const dependenciesCache = new Map<string, string[]>();
const binCache = new Map<string, string[]>();
let workspacePackagesCache: string[] | undefined = undefined;

const lifecycleScripts = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'pretest', 'test', 'posttest', 'prestart', 'start', 'poststart', 'prestop', 'stop', 'poststop', 'preversion', 'version', 'postversion']);

export async function getCompletions(
    textBeforeCursor: string,
    cursorPosition: number,
    cwd: string | undefined,
    scriptsCacheMap: Map<string, Record<string, string>>,
    getWorkspacePackageNames?: () => Promise<string[]>
): Promise<vscode.TerminalCompletionItem[]> {

    const config = vscode.workspace.getConfiguration('terminalNpmIntellisense');
    const enabledManagers = config.get<string[]>('enabledManagers') || ['npm', 'yarn', 'pnpm', 'bun'];

    const workspaceMatch = textBeforeCursor.match(/(?:--workspace|-w|--filter)\s+([^\s]*)$/) || textBeforeCursor.match(/^yarn\s+workspace\s+([^\s]*)$/);

    if (workspaceMatch && getWorkspacePackageNames) {
        const prefix = workspaceMatch[1];
        const replacementStart = cursorPosition - prefix.length;
        const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];

        const names = await getWorkspacePackageNames();
        const completions: vscode.TerminalCompletionItem[] = [];

        for (const name of names) {
            if (prefix && !name.startsWith(prefix)) {
                continue;
            }
            const item = new vscode.TerminalCompletionItem(
                name,
                replacementRange,
                vscode.TerminalCompletionItemKind.Folder
            );
            item.detail = 'Workspace Package';
            completions.push(item);
        }

        return completions;
    }

    const removeMatch = textBeforeCursor.match(/^(?:(?:npm|bun)\s*(?:uninstall|rm|r|un)|(?:yarn|pnpm)\s*remove)\s+(?:.*?\s+)*([^\s]*)$/);
    if (removeMatch && typeof cwd === 'string') {
        const prefix = removeMatch[1] || '';
        const replacementStart = cursorPosition - prefix.length;
        const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];
        return await getDependencyCompletions(cwd, prefix, replacementRange);
    }

    const binMatch = textBeforeCursor.match(/^(?:(?:n|bun|pn)px|(?:pnpm|yarn)\s+(?:exec|dlx))\s+([^\s]*)$/);
    if (binMatch && typeof cwd === 'string') {
        const prefix = binMatch[1] || '';
        const replacementStart = cursorPosition - prefix.length;
        const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];
        return await getBinCompletions(cwd, prefix, replacementRange);
    }

    const mngPattern = enabledManagers.join('|');
    const runMatchRegex = new RegExp('^(' + mngPattern + ')\\s+run\\s+([^\\\\s]*)$');
    const yarnMatchRegex = new RegExp('^yarn\\s+([^\\\\s]*)$');

    const npmPnpmBunMatch = textBeforeCursor.match(runMatchRegex);
    const yarnMatch = enabledManagers.includes('yarn') ? textBeforeCursor.match(yarnMatchRegex) : null;

    const match = npmPnpmBunMatch || yarnMatch;

    if (!match) {
        return [];
    }

    const prefix = match[2] !== undefined ? match[2] : match[1];
    const replacementStart = cursorPosition - prefix.length;
    const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];

    if (!cwd) {
        return [];
    }

    let currentDir = cwd;
    let scripts: Record<string, string> | undefined = undefined;

    while (true) {
        if (scriptsCacheMap.has(currentDir)) {
            scripts = scriptsCacheMap.get(currentDir);
            break;
        }

        const packageJsonPath = path.join(currentDir, 'package.json');
        try {
            const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
            const pkg = JSON.parse(packageJsonContent.replace(/^\uFEFF/, ''));
            const parsedScripts = (pkg.scripts as Record<string, string>) || {};
            scripts = parsedScripts;
            scriptsCacheMap.set(currentDir, parsedScripts);
            break;
        } catch (err) {
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }
    }

    if (!scripts) return [];

    const completions: vscode.TerminalCompletionItem[] = [];

    for (const [scriptName, scriptCommand] of Object.entries(scripts)) {
        if (prefix && !scriptName.startsWith(prefix)) continue;

        const isLifecycle = lifecycleScripts.has(scriptName);
        const item = new vscode.TerminalCompletionItem(
            isLifecycle ? `? ${scriptName}` : scriptName,
            replacementRange,
            vscode.TerminalCompletionItemKind.Method
        );
        
        const doc = new vscode.MarkdownString();
        doc.appendMarkdown(`**Script:** \`${scriptName}\`\n\n`);
        doc.appendCodeblock(scriptCommand as string, 'bash');
        if (isLifecycle) {
            doc.appendMarkdown('\n*Built-in npm lifecycle script.*');
        }
        item.documentation = doc;
        item.detail = scriptCommand as string;
        
        completions.push(item);
    }

    return completions;
}

async function getDependencyCompletions(cwd: string, prefix: string, replacementRange: readonly [number, number]): Promise<vscode.TerminalCompletionItem[]> {
    let currentDir = cwd;
    let deps: string[] = [];

    while (true) {
        if (dependenciesCache.has(currentDir)) {
            deps = dependenciesCache.get(currentDir)!;
            break;
        }

        const packageJsonPath = path.join(currentDir, 'package.json');
        try {
            const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
            const pkg = JSON.parse(packageJsonContent.replace(/^\uFEFF/, ''));
            const d = Object.keys(pkg.dependencies || {});
            const dd = Object.keys(pkg.devDependencies || {});
            const pd = Object.keys(pkg.peerDependencies || {});
            deps = Array.from(new Set([...d, ...dd, ...pd]));
            dependenciesCache.set(currentDir, deps);
            break;
        } catch (err) {
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }
    }

    const completions: vscode.TerminalCompletionItem[] = [];
    for (const dep of deps) {
        if (prefix && !dep.startsWith(prefix)) continue;
        const item = new vscode.TerminalCompletionItem(
            dep,
            replacementRange,
            vscode.TerminalCompletionItemKind.Method
        );
        item.detail = 'Dependency';
        completions.push(item);
    }
    return completions;
}

async function getBinCompletions(cwd: string, prefix: string, replacementRange: readonly [number, number]): Promise<vscode.TerminalCompletionItem[]> {
    let currentDir = cwd;
    let bins: string[] = [];

    while (true) {
        if (binCache.has(currentDir)) {
            bins = binCache.get(currentDir)!;
            break;
        }

        const binPath = path.join(currentDir, 'node_modules', '.bin');
        try {
            const files = await fs.readdir(binPath);
            const binSet = new Set<string>();
            for (const file of files) {
                if (file.startsWith('.')) continue; // skip hidden files
                const name = file.replace(/\.(cmd|ps1|exe)$/i, '');
                binSet.add(name);
            }
            bins = Array.from(binSet);
            binCache.set(currentDir, bins);
            break;
        } catch (err) {
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) break;
            currentDir = parentDir;
        }
    }

    const completions: vscode.TerminalCompletionItem[] = [];
    for (const bin of bins) {
        if (prefix && !bin.startsWith(prefix)) continue;
        const item = new vscode.TerminalCompletionItem(
            bin,
            replacementRange,
            vscode.TerminalCompletionItemKind.Method
        );
        item.detail = 'Executable Bin';
        completions.push(item);
    }
    return completions;
}

export function activate(context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    const clearCache = (uri: vscode.Uri) => {
        scriptsCache.delete(path.dirname(uri.fsPath));
        dependenciesCache.delete(path.dirname(uri.fsPath));
        binCache.delete(path.dirname(uri.fsPath));
        workspacePackagesCache = undefined;
    };

    watcher.onDidChange(clearCache);
    watcher.onDidCreate(clearCache);
    watcher.onDidDelete(clearCache);
    context.subscriptions.push(watcher);

    const fetchWorkspacePackageNames = async (): Promise<string[]> => {
        if (workspacePackagesCache !== undefined) return workspacePackagesCache;
        workspacePackagesCache = [];
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) return workspacePackagesCache;

        const config = vscode.workspace.getConfiguration('terminalNpmIntellisense');
        const excludes = config.get<string[]>('excludePatterns') || ['**/node_modules/**', '**/dist/**', '**/build/**'];
        const excludePattern = '{' + excludes.join(',') + '}';

        try {
            const uris = await vscode.workspace.findFiles('**/package.json', excludePattern);
            for (const uri of uris) {
                try {
                    const content = await fs.readFile(uri.fsPath, 'utf8');
                    const pkg = JSON.parse(content.replace(/^\uFEFF/, ''));
                    if (pkg && typeof pkg.name === 'string') workspacePackagesCache.push(pkg.name);
                } catch {}
            }
        } catch {}
        return workspacePackagesCache;
    };

    const provider = vscode.window.registerTerminalCompletionProvider({
        async provideTerminalCompletions(terminal: vscode.Terminal, completionContext: vscode.TerminalCompletionContext) {
            const commandLine = completionContext.commandLine;
            const cursorPosition = (completionContext as any).cursorPosition ?? (completionContext as any).cursorIndex ?? commandLine.length;
            const textBeforeCursor = commandLine.slice(0, cursorPosition);
            let cwd: string | undefined;
            if (terminal.shellIntegration && terminal.shellIntegration.cwd) {
                cwd = terminal.shellIntegration.cwd.fsPath;
            } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
            }
            return getCompletions(textBeforeCursor, cursorPosition, cwd, scriptsCache, fetchWorkspacePackageNames);
        }
    }, ' ', 'run', 'remove', 'uninstall', 'rm', 'r', 'un', 'npx', 'pnpx', 'bunx', 'exec', 'dlx');

    context.subscriptions.push(provider);
}

export function deactivate() {
    scriptsCache.clear();
    dependenciesCache.clear();
    binCache.clear();
}

