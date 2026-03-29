# ![Banner](./assets/npm_banner.png)

Boost your productivity with native **IntelliSense in the VS Code Integrated Terminal**! This extension provides real-time autocomplete suggestions for your project's commands, script names, workspace packages, and dependencies.

Say goodbye to constantly opening your `package.json` to remember exactly how you named that one build script.

## Features

### 1. Smart Script Autocompletion

Provides rapid autocomplete suggestions for package scripts right when you type your package manager's run command.

- **npm**: `npm run <script>`
- **pnpm**: `pnpm run <script>`
- **bun**: `bun run <script>`
- **yarn**: `yarn <script>`

![Smart Script Autocompletion Showcase](./assets/npm_run_showcase.png)

### 2. Dependency Uninstall & Removal Autocompletion

Can't remember the exact name of an installed package? We've got you.

Get autocomplete suggestions for your installed packages when you run removal commands:

- `npm uninstall <package>` / `npm rm <package>`
- `yarn remove <package>`
- `pnpm remove <package>`
- `bun rm <package>`

![Dependency Uninstall Autocompletion Showcase](./assets/npm_uninstall_showcase.png)

### 3. Executable Binaries Autocompletion

Quickly execute local packages from your `node_modules/.bin` directory. Support includes:

- `npx <bin>`
- `pnpm exec <bin>` / `pnpm dlx <bin>`
- `yarn dlx <bin>`
- `bunx <bin>`

![Executable Binaries Autocompletion Showcase](./assets/npx_showcase.png)

### 4. Monorepo Workspace Suggestions

Easily run scripts into targeted monorepo packages! When providing workspace filter flags, the extension suggests available scoped package names:

- `npm run dev --workspace <package-name>`
- `yarn workspace <package-name>`
- `pnpm --filter <package-name>`

![Monorepo Workspace Suggestions Showcase](./assets/npm_run_workspace_showcase.png)

## Configuration Settings

Customize how the extension behaves via VS Code settings (`settings.json`):

| Setting | Type | Default | Description |
| ------- | ---- | ------- | ----------- |
| `terminalNpmIntellisense.enabledManagers` | `Array` | `["npm", "yarn", "pnpm", "bun"]` | Toggle Autocomplete for specific package managers. |
| `terminalNpmIntellisense.excludePatterns` | `Array` | `["**/node_modules/**", "**/dist/**", "**/build/**"]` | Glob patterns to ignore when deep-scanning monorepo workspace packages. |

## Contributing

Love the extension and want to add a feature or fix a bug? Check out the [Contributing Guide](CONTRIBUTING.md) for local development instructions!

---
**Enjoying the extension?** Don't forget to leave a review and a ⭐ on the VS Code Marketplace!
