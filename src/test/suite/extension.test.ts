import * as assert from 'assert';
import * as path from 'path';
import { getCompletions } from '../../extension';

suite('Terminal Completion Logic', () => {

    const testWorkspaceRoot = path.join(__dirname, '../../../test-workspace');
    const scriptsCacheMap = new Map<string, Record<string, string>>();

    setup(() => {
        scriptsCacheMap.clear();
    });

    test('npm run suggestions at root', async () => {
        const completions = await getCompletions('npm run ', 8, testWorkspaceRoot, scriptsCacheMap);
        assert.strictEqual(completions.length, 2);
        assert.strictEqual(completions[0].label, 'build');
        assert.strictEqual(completions[1].label, 'test');
    });

    test('npm run filtered suggestions', async () => {
        const completions = await getCompletions('npm run b', 9, testWorkspaceRoot, scriptsCacheMap);
        assert.strictEqual(completions.length, 1);
        assert.strictEqual(completions[0].label, 'build');
    });

    test('yarn suggestions', async () => {
        const completions = await getCompletions('yarn ', 5, testWorkspaceRoot, scriptsCacheMap);
        assert.strictEqual(completions.length, 2);
    });

    test('pnpm run suggestions', async () => {
        const completions = await getCompletions('pnpm run ', 9, testWorkspaceRoot, scriptsCacheMap);
        assert.strictEqual(completions.length, 2);
    });

    test('monorepo nested package.json nearest resolution', async () => {
        const webDir = path.join(testWorkspaceRoot, 'apps/web');
        const completions = await getCompletions('npm run ', 8, webDir, scriptsCacheMap);
        assert.strictEqual(completions.length, 2);
        assert.strictEqual(completions[0].label, 'build');
        assert.strictEqual(completions[0].detail, 'next build');
    });

    test('monorepo nested directory without package.json traverses up', async () => {
        const apiDir = path.join(testWorkspaceRoot, 'apps/api');
        const completions = await getCompletions('npm run ', 8, apiDir, scriptsCacheMap);
        assert.strictEqual(completions.length, 2);
        assert.strictEqual(completions[0].label, 'build');
        assert.strictEqual(completions[0].detail, 'tsc');
    });

    test('no suggestions for unrelated commands', async () => {
        const completions = await getCompletions('echo npm run ', 13, testWorkspaceRoot, scriptsCacheMap);
        assert.strictEqual(completions.length, 0);
    });

    test('graceful fail when no package.json in system', async () => {
        const rootDir = path.resolve('/');
        const completions = await getCompletions('npm run ', 8, rootDir, scriptsCacheMap);
        assert.strictEqual(completions.length, 0);
    });
});



