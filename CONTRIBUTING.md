# Contributing to Terminal NPM IntelliSense

First off, thank you for considering contributing to the extension! It's people like you that make tools better for everyone.

## Development Setup

1. **Clone the repository:** Clone the repo to your local machine.
2. **Install dependencies:** Run npm install to install all necessary packages.
3. **Compile the extension:** Run npm run compile to build the TypeScript source code. Or run npm run watch to watch for file changes during development.

## Testing Locally

To test this extension locally and observe your changes:

1. Open this repository in VS Code.
2. Ensure you have run npm install.
3. Press F5 to launch the Extension Development Host.
4. In the new child window, open the integrated terminal.
5. In a project with a package.json, type npm run  or yarn  and press Ctrl+Space to trigger the suggestions!

## Running Unit Tests

Isolated unit tests exist under src/test. To execute them:

- Run npm test from the command line, OR
- Use the built-in testing capabilities in VS Code.
