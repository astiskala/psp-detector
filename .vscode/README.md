# VS Code Setup for GTS

This project is configured to use Google TypeScript Style Guide (GTS) for code formatting instead of Prettier.

## What's Configured

### Workspace Settings (`.vscode/settings.json`)
- **ESLint as Default Formatter**: TypeScript and JavaScript files use ESLint for formatting
- **Prettier Disabled**: Prettier is explicitly disabled for TypeScript/JavaScript files
- **Auto-Fix on Save**: ESLint automatically fixes issues when you save files
- **Google Style Guide Settings**: Tab size, indentation, and line endings match GTS standards

### Extensions (`.vscode/extensions.json`)
- **Recommended**: ESLint extension (`dbaeumer.vscode-eslint`)
- **Not Recommended**: Prettier extension (to avoid conflicts)

### VS Code Tasks (`.vscode/tasks.json`)
Available tasks you can run with `Cmd+Shift+P` → "Tasks: Run Task":
- **GTS: Fix** - Format all files using gts
- **GTS: Lint** - Check code style and quality
- **Build** - Build the Chrome extension
- **Test** - Run all tests

## How to Use

### Formatting Code
1. **Automatic**: Save any TypeScript/JavaScript file (Cmd+S) and ESLint will auto-fix
2. **Manual**: Use `Cmd+Shift+P` → "Format Document" or run the "GTS: Fix" task
3. **All Files**: Run `npm run format` in terminal

### Checking Code Quality
- **Live**: ESLint shows errors/warnings as you type
- **Manual**: Run the "GTS: Lint" task or `npm run lint` in terminal

### Keyboard Shortcuts
- `Cmd+S` - Save and auto-fix with ESLint
- `Shift+Alt+F` - Format document (uses ESLint)
- `Cmd+Shift+P` → "Tasks: Run Task" - Access all project tasks

## Benefits

✅ **Consistent**: Same formatting in VS Code and npm scripts
✅ **Google Style**: Follows Google TypeScript Style Guide
✅ **Auto-Fix**: Formats on save automatically
✅ **No Conflicts**: No Prettier vs ESLint formatting battles
✅ **Team Sync**: Everyone gets the same formatting behavior
