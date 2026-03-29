import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

const scriptsCache = new Map<string, Record<string, string>>();
const dependenciesCache = new Map<string, {name: string, type: string, version?: string}[]>();
const binCache = new Map<string, string[]>();
let workspacePackagesCache: Map<string, string> | undefined = undefined;

const lifecycleScripts = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'pretest', 'test', 'posttest', 'prestart', 'start', 'poststart', 'prestop', 'stop', 'poststop', 'preversion', 'version', 'postversion']);

export async function getCompletions(
    textBeforeCursor: string,
    cursorPosition: number,
    cwd: string | undefined,
    scriptsCacheMap: Map<string, Record<string, string>>,
    getWorkspacePackages?: () => Promise<Map<string, string>>
): Promise<vscode.TerminalCompletionItem[] | vscode.TerminalCompletionList> {

    const config = vscode.workspace.getConfiguration('terminalNpmIntellisense');
    const enabledManagers = config.get<string[]>('enabledManagers') || ['npm', 'yarn', 'pnpm', 'bun'];

    const workspaceMatch = textBeforeCursor.match(/(?:--workspace|-w|--filter)\s+([^\s]*)$/) || textBeforeCursor.match(/^yarn\s+workspace\s+([^\s]*)$/);

    if (workspaceMatch && getWorkspacePackages) {
        const prefix = workspaceMatch[1] || '';
        const replacementStart = cursorPosition - prefix.length;
        const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];

        const map = await getWorkspacePackages();
        const completions: vscode.TerminalCompletionItem[] = [];

        for (const name of map.keys()) {
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

        const resourceOptions = cwd ? { showFiles: false, showDirectories: false, cwd: vscode.Uri.file(cwd) } : undefined;
        return new vscode.TerminalCompletionList(completions, resourceOptions);
    }

    const commandFlagMatch = textBeforeCursor.match(/^(npm|pnpm|bun)\s+(--?[a-zA-Z0-9\-]*)$|^((?:npm|pnpm|bun)\s+)$/);
    if (commandFlagMatch) {
        const prefix = commandFlagMatch[2] || '';
        if ('--workspace'.startsWith(prefix) || '-w'.startsWith(prefix)) {
            const replacementStart = cursorPosition - prefix.length;
            const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];
            const completions: vscode.TerminalCompletionItem[] = [];
            if ('--workspace'.startsWith(prefix)) {
                completions.push(new vscode.TerminalCompletionItem('--workspace', replacementRange, vscode.TerminalCompletionItemKind.Flag));
            }
            if ('-w'.startsWith(prefix)) {
                completions.push(new vscode.TerminalCompletionItem('-w', replacementRange, vscode.TerminalCompletionItemKind.Flag));
            }
            const resourceOptions = cwd ? { showFiles: false, showDirectories: false, cwd: vscode.Uri.file(cwd) } : undefined;
            if (completions.length > 0) return new vscode.TerminalCompletionList(completions, resourceOptions);
        }
    }

    const subcommandMatch = textBeforeCursor.match(/^(npm|pnpm|bun)\s+(?:--workspace|-w|--filter|-F)\s*=?\s*[^\s]+\s+([a-zA-Z0-9\-]*)$|^((?:npm|pnpm|bun)\s+(?:--workspace|-w|--filter|-F)\s*=?\s*[^\s]+\s+)$/);
    if (subcommandMatch) {
        const prefix = subcommandMatch[2] || '';
        const replacementStart = cursorPosition - prefix.length;
        const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];
        const commands = ['run', 'install', 'add', 'remove', 'uninstall', 'update', 'view', 'info', 'show', 'test', 'start', 'publish', 'link', 'unlink', 'exec'];
        
        const completions: vscode.TerminalCompletionItem[] = [];
        for (const cmd of commands) {
            if (prefix && !cmd.startsWith(prefix)) continue;
            completions.push(new vscode.TerminalCompletionItem(
                cmd,
                replacementRange,
                vscode.TerminalCompletionItemKind.Method
            ));
        }
        const resourceOptions = cwd ? { showFiles: false, showDirectories: false, cwd: vscode.Uri.file(cwd) } : undefined;
        if (completions.length > 0) return new vscode.TerminalCompletionList(completions, resourceOptions);
    }

    const linkMatch = textBeforeCursor.match(/^(?:(?:npm|pnpm|yarn|bun)\s+link)\s+([^\s]*)$/);
    if (linkMatch && typeof cwd === 'string') {
        const prefix = linkMatch[1] || '';
        const replacementStart = cursorPosition - prefix.length;
        const replacementRange: readonly [number, number] = [replacementStart, cursorPosition];
        return await getLinkCompletions(cwd, prefix, replacementRange, getWorkspacePackages);
    }

    const depCmdMatch = textBeforeCursor.match(/^(?:(?:npm|bun)\s*(?:uninstall|rm|r|un|update|up|view|v|info|show)|(?:yarn|pnpm)\s*(?:remove|rm|upgrade|up|info|view))\s+(?:.*?\s+)*([^\s]*)$/);
    if (depCmdMatch && typeof cwd === 'string') {
        const prefix = depCmdMatch[1] || '';
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
    let scriptPrefix = '';
    let targetWorkspace: string | undefined = undefined;
    let runReplacementStart = cursorPosition;

    const specificWorkspaceRunMatch = textBeforeCursor.match(/^(?:npm|pnpm|bun)\s+(?:--workspace|-w)\s*=?\s*([^\s]+)\s+run\s+([^\s]*)$/);
    const yarnWorkspaceRunMatch = enabledManagers.includes('yarn') ? textBeforeCursor.match(/^yarn\s+workspace\s+([^\s]+)\s+(?:run\s+)?([^\s]*)$/) : null;

    if (specificWorkspaceRunMatch) {
        targetWorkspace = specificWorkspaceRunMatch[1];
        scriptPrefix = specificWorkspaceRunMatch[2] || '';
        runReplacementStart = cursorPosition - scriptPrefix.length;
    } else if (yarnWorkspaceRunMatch) {
        targetWorkspace = yarnWorkspaceRunMatch[1];
        scriptPrefix = yarnWorkspaceRunMatch[2] || '';
        runReplacementStart = cursorPosition - scriptPrefix.length;
    } else {
        const runMatchRegex = new RegExp('^(' + mngPattern + ')\\s+run\\s+([^\\\\s]*)$');
        const yarnMatchRegex = new RegExp('^yarn\\s+([^\\\\s]*)$');

        const npmPnpmBunMatch = textBeforeCursor.match(runMatchRegex);
        const yarnMatch = enabledManagers.includes('yarn') ? textBeforeCursor.match(yarnMatchRegex) : null;

        const match = npmPnpmBunMatch || yarnMatch;

        if (!match) {
            return [];
        }

        scriptPrefix = match[2] !== undefined ? match[2] : match[1];
        runReplacementStart = cursorPosition - scriptPrefix.length;
    }

    const replacementRange: readonly [number, number] = [runReplacementStart, cursorPosition];

    if (targetWorkspace && getWorkspacePackages) {
        const map = await getWorkspacePackages();
        const wsDir = map.get(targetWorkspace);
        if (wsDir) {
            cwd = wsDir;
        } else {
            return [];
        }
    }

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
        if (scriptPrefix && !scriptName.startsWith(scriptPrefix)) continue;

        const isLifecycle = lifecycleScripts.has(scriptName);
        const item = new vscode.TerminalCompletionItem(
            scriptName,
            replacementRange,
            vscode.TerminalCompletionItemKind.Method
        );
        
        const doc = new vscode.MarkdownString();
        doc.appendMarkdown(`**Script:** \`${scriptName}\`\n\n`);
        doc.appendCodeblock(scriptCommand as string, 'bash');
        if (isLifecycle) {
            doc.appendMarkdown('\n*Built-in npm lifecycle script.*');
            item.detail = '🔄 ' + (scriptCommand as string);
        } else {
            item.detail = scriptCommand as string;
        }
        item.documentation = doc;
        
        completions.push(item);
    }

    const resourceOptions = cwd ? { showFiles: false, showDirectories: false, cwd: vscode.Uri.file(cwd) } : undefined;
    return new vscode.TerminalCompletionList(completions, resourceOptions);
}

async function getDependencyCompletions(cwd: string, prefix: string, replacementRange: readonly [number, number]): Promise<vscode.TerminalCompletionList> {
    let currentDir = cwd;
    let deps: {name: string, type: string, version?: string}[] = [];

    while (true) {
        if (dependenciesCache.has(currentDir)) {
            deps = dependenciesCache.get(currentDir)!;
            break;
        }

        const packageJsonPath = path.join(currentDir, 'package.json');
        try {
            const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
            const pkg = JSON.parse(packageJsonContent.replace(/^\uFEFF/, ''));
            const depsMap = new Map<string, {name: string, type: string, version?: string}>();

            const addDeps = async (obj: any, typeName: string) => {
                if (!obj) return;
                for (const dep of Object.keys(obj)) {
                    if (!depsMap.has(dep)) {
                        let version: string | undefined;
                        try {
                            const depPkgPath = path.join(currentDir, 'node_modules', dep, 'package.json');
                            const depPkgContent = await fs.readFile(depPkgPath, 'utf8');
                            const depPkg = JSON.parse(depPkgContent.replace(/^\uFEFF/, ''));
                            version = depPkg.version;
                        } catch (e) {
                            version = undefined;
                        }
                        depsMap.set(dep, { name: dep, type: typeName, version });
                    }
                }
            };

            await addDeps(pkg.dependencies, 'dependencies');
            await addDeps(pkg.devDependencies, 'devDependencies');
            await addDeps(pkg.peerDependencies, 'peerDependencies');

            deps = Array.from(depsMap.values());
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
        if (prefix && !dep.name.startsWith(prefix)) continue;
        const item = new vscode.TerminalCompletionItem(
            dep.name,
            replacementRange,
            vscode.TerminalCompletionItemKind.Method
        );
        let detail = dep.type;
        if (dep.version) {
            detail += ` • v${dep.version}`;
        }
        item.detail = detail;
        completions.push(item);
    }
    return new vscode.TerminalCompletionList(completions, { showFiles: false, showDirectories: false, cwd: vscode.Uri.file(cwd) });
}

async function getBinCompletions(cwd: string, prefix: string, replacementRange: readonly [number, number]): Promise<vscode.TerminalCompletionList> {
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
    return new vscode.TerminalCompletionList(completions, { showFiles: false, showDirectories: false, cwd: vscode.Uri.file(cwd) });
}

async function getLinkCompletions(
    cwd: string, 
    prefix: string, 
    replacementRange: readonly [number, number],
    getWorkspacePackages?: () => Promise<Map<string, string>>
): Promise<vscode.TerminalCompletionList> {
    const completions: vscode.TerminalCompletionItem[] = [];
    const seenPaths = new Set<string>();

    if (getWorkspacePackages) {
        const packages = await getWorkspacePackages();
        for (const [pkgName, pkgDir] of packages.entries()) {
            let relPath = path.relative(cwd, pkgDir).replace(/\\/g, '/');
            if (relPath === '') continue; // Skip strictly self-linking

            // Let VS Code's native directory provider handle direct children.
            // A direct child has no directory separators and isn't '..'
            if (!relPath.includes('/') && relPath !== '..') continue;

            if (!relPath.startsWith('.') && !relPath.startsWith('/')) {
                relPath = './' + relPath;
            }

            if (!seenPaths.has(relPath)) {
                seenPaths.add(relPath);
                if (prefix && !relPath.startsWith(prefix) && !pkgName.startsWith(prefix)) continue;
                const item = new vscode.TerminalCompletionItem(relPath, replacementRange, vscode.TerminalCompletionItemKind.SymbolicLinkFolder);
                item.detail = `📦 ${pkgName}`;
                completions.push(item);
            }
        }
    }
    
    return new vscode.TerminalCompletionList(completions, { 
        showFiles: false, 
        showDirectories: true, 
        cwd: vscode.Uri.file(cwd) 
    });
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

    const clearAllCachesCommand = vscode.commands.registerCommand('terminalNpmIntellisense.clearCache', () => {
        scriptsCache.clear();
        dependenciesCache.clear();
        binCache.clear();
        workspacePackagesCache = undefined;
        vscode.window.showInformationMessage('Terminal NPM IntelliSense: Caches cleared.');
    });
    context.subscriptions.push(clearAllCachesCommand);

    const fetchWorkspacePackages = async (): Promise<Map<string, string>> => {        
        if (workspacePackagesCache !== undefined) return workspacePackagesCache;
        workspacePackagesCache = new Map();
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) return workspacePackagesCache;

        const config = vscode.workspace.getConfiguration('terminalNpmIntellisense');
        const excludes = config.get<string[]>('excludePatterns') || ['**/node_modules/**', '**/dist/**', '**/build/**'];
        const excludePattern = '{' + excludes.join(',') + '}';

        let foundAnyWorkspaceConfig = false;

        const parsePackages = async (uris: vscode.Uri[]) => {
            for (const uri of uris) {
                try {
                    const content = await fs.readFile(uri.fsPath, 'utf8');
                    const pkg = JSON.parse(content.replace(/^\uFEFF/, ''));
                    if (pkg && typeof pkg.name === 'string') {
                        workspacePackagesCache!.set(pkg.name, path.dirname(uri.fsPath));
                    }
                } catch {}
            }
        };

        try {
            for (const folder of vscode.workspace.workspaceFolders) {
                let workspaces: string[] = [];

                // 1. package.json workspaces
                try {
                    const pkgPath = path.join(folder.uri.fsPath, 'package.json');
                    const pkgContent = await fs.readFile(pkgPath, 'utf8');
                    const pkg = JSON.parse(pkgContent.replace(/^\uFEFF/, ''));
                    if (pkg.workspaces) {
                        if (Array.isArray(pkg.workspaces)) {
                            workspaces.push(...pkg.workspaces);
                        } else if (Array.isArray(pkg.workspaces.packages)) {
                            workspaces.push(...pkg.workspaces.packages);
                        }
                    }
                } catch {}

                // 2. pnpm-workspace.yaml
                try {
                    const pnpmPath = path.join(folder.uri.fsPath, 'pnpm-workspace.yaml');
                    const pnpmContent = await fs.readFile(pnpmPath, 'utf8');
                    const lines = pnpmContent.split('\n');
                    let inPackages = false;
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed === 'packages:') {
                            inPackages = true;
                            continue;
                        }
                        if (inPackages) {
                            if (trimmed.startsWith('-')) {
                                const packageStr = trimmed.slice(1).trim().replace(/['"]/g, '');
                                if (packageStr && !packageStr.startsWith('#')) {
                                    workspaces.push(packageStr);
                                }
                            } else if (trimmed && !trimmed.startsWith('#')) {
                                inPackages = false;
                            }
                        }
                    }
                } catch {}

                // 3. lerna.json
                try {
                    const lernaPath = path.join(folder.uri.fsPath, 'lerna.json');
                    const lernaContent = await fs.readFile(lernaPath, 'utf8');
                    const lerna = JSON.parse(lernaContent.replace(/^\uFEFF/, ''));
                    if (Array.isArray(lerna.packages)) {
                        workspaces.push(...lerna.packages);
                    }
                } catch {}

                if (workspaces.length > 0) {
                    foundAnyWorkspaceConfig = true;
                    const workspacePatterns = workspaces.map(w => {
                        let normalized = w.replace(/\\/g, '/');
                        if (normalized.endsWith('/')) {
                            normalized = normalized.slice(0, -1);
                        }
                        if (!normalized.endsWith('package.json')) {
                            normalized = `${normalized}/package.json`;
                        }
                        return normalized;
                    });
                    
                    const pattern = workspacePatterns.length === 1 
                        ? workspacePatterns[0] 
                        : `{${workspacePatterns.join(',')}}`;
                    const relativePattern = new vscode.RelativePattern(folder, pattern);
                    
                    try {
                        const uris = await vscode.workspace.findFiles(relativePattern, excludePattern);
                        await parsePackages(uris);
                    } catch {}
                }
            }

            if (!foundAnyWorkspaceConfig) {
                const uris = await vscode.workspace.findFiles('**/package.json', excludePattern);
                await parsePackages(uris);
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
            return getCompletions(textBeforeCursor, cursorPosition, cwd, scriptsCache, fetchWorkspacePackages);
        }
    }, ' ', '-', 'run', 'remove', 'uninstall', 'rm', 'r', 'un', 'update', 'up', 'upgrade', 'view', 'v', 'info', 'show', 'npx', 'pnpx', 'bunx', 'exec', 'dlx', 'install', 'i', 'link', 'add', 'test', 'start', 'publish', 'unlink');      


    context.subscriptions.push(provider);
}

export function deactivate() {
    scriptsCache.clear();
    dependenciesCache.clear();
    binCache.clear();
}
