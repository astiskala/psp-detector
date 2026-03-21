import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const cwd = process.cwd();
const tsconfigPath = path.join(cwd, 'tsconfig.json');
const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

if (configFile.error) {
  throw new Error(
    ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'),
  );
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  cwd,
);

const files = parsedConfig.fileNames
  .map((filePath) => path.resolve(filePath))
  .filter(
    (filePath) =>
      filePath.includes(`${path.sep}src${path.sep}`) &&
      !filePath.endsWith('.test.ts') &&
      !filePath.endsWith('.spec.ts') &&
      !filePath.includes(`${path.sep}src${path.sep}test-helpers${path.sep}`),
  );

const scriptVersions = new Map(
  files.map((filePath) => [filePath, String(fs.statSync(filePath).mtimeMs)]),
);

const languageServiceHost = {
  getCompilationSettings: () => parsedConfig.options,
  getCurrentDirectory: () => cwd,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  getScriptFileNames: () => files,
  getScriptVersion: (fileName) =>
    scriptVersions.get(path.resolve(fileName)) ?? '0',
  readFile: ts.sys.readFile,
  fileExists: ts.sys.fileExists,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  getScriptSnapshot: (fileName) => {
    const contents = ts.sys.readFile(fileName);
    return contents === undefined
      ? undefined
      : ts.ScriptSnapshot.fromString(contents);
  },
};

const languageService = ts.createLanguageService(
  languageServiceHost,
  ts.createDocumentRegistry(),
);

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isMethodPublic(node) {
  return (
    !hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
    !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
  );
}

function getMethodName(node) {
  if (
    ts.isIdentifier(node.name) ||
    ts.isStringLiteral(node.name) ||
    ts.isNumericLiteral(node.name)
  ) {
    return node.name.text;
  }

  return null;
}

function isDefinitionReference(reference, declarationPath) {
  return (
    reference.isDefinition === true &&
    path.resolve(reference.fileName) === declarationPath
  );
}

function findUnusedPublicMethods(sourceFile) {
  const issues = [];

  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && isMethodPublic(node)) {
      const methodName = getMethodName(node);
      if (methodName === null || node.name === undefined) {
        ts.forEachChild(node, visit);
        return;
      }

      const position = node.name.getStart(sourceFile);
      const references =
        languageService.findReferences(sourceFile.fileName, position) ?? [];

      const declarationPath = path.resolve(sourceFile.fileName);
      let hasNonDefinitionReference = false;
      for (const referencedSymbol of references) {
        for (const reference of referencedSymbol.references) {
          if (!isDefinitionReference(reference, declarationPath)) {
            hasNonDefinitionReference = true;
            break;
          }
        }

        if (hasNonDefinitionReference) {
          break;
        }
      }

      if (!hasNonDefinitionReference) {
        const owner = node.parent;
        const className =
          ts.isClassLike(owner) && owner.name !== undefined
            ? owner.name.text
            : '<anonymous>';
        const { line, character } =
          sourceFile.getLineAndCharacterOfPosition(position);
        issues.push({
          filePath: declarationPath,
          line: line + 1,
          column: character + 1,
          className,
          methodName,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return issues;
}

const issues = [];
for (const filePath of files) {
  const program = languageService.getProgram();
  const sourceFile = program?.getSourceFile(filePath);
  if (sourceFile === undefined) {
    continue;
  }

  issues.push(...findUnusedPublicMethods(sourceFile));
}

if (issues.length > 0) {
  for (const issue of issues) {
    process.stderr.write(
      `${issue.filePath}:${issue.line}:${issue.column} ` +
        `unused public method ${issue.className}.${issue.methodName}\n`,
    );
  }

  process.exitCode = 1;
} else {
  process.stdout.write(
    'No unused public methods found in production TypeScript.\n',
  );
}
