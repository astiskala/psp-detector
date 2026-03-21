import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import * as cheerio from 'cheerio';

const URL_ATTRIBUTES = ['action', 'cite', 'data', 'href', 'poster', 'src'];

function fail(message) {
  process.stderr.write(`${message}\n`);
}

function ok(message) {
  process.stdout.write(`${message}\n`);
}

function ensure(condition, message, issues) {
  if (!condition) {
    issues.push(message);
  }
}

function checkProtocolRelativeUrls($, filePath, issues) {
  for (const attribute of URL_ATTRIBUTES) {
    $(`[${attribute}]`).each((_, element) => {
      const value = $(element).attr(attribute)?.trim();

      if (value?.startsWith('//')) {
        issues.push(
          `${filePath}: protocol-relative URL in ` +
            `${element.tagName}[${attribute}]="${value}"`,
        );
      }
    });
  }
}

async function lintHtml(filePath) {
  const issues = [];
  const contents = await readFile(filePath, 'utf8');
  const $ = cheerio.load(contents);
  const normalized = contents.trimStart().toLowerCase();

  ensure(
    normalized.startsWith('<!doctype html>'),
    `${filePath}: expected document to start with <!doctype html>`,
    issues,
  );

  ensure(
    $('html').length === 1,
    `${filePath}: expected a single <html> element`,
    issues,
  );
  ensure(
    $('head').length === 1,
    `${filePath}: expected a single <head> element`,
    issues,
  );
  ensure(
    $('body').length === 1,
    `${filePath}: expected a single <body> element`,
    issues,
  );

  const charset = $('meta[charset]').first().attr('charset')?.toLowerCase();
  ensure(
    charset === 'utf-8',
    `${filePath}: expected <meta charset="utf-8">`,
    issues,
  );
  ensure(
    $('meta[name="viewport"]').length > 0,
    `${filePath}: expected a viewport meta tag`,
    issues,
  );

  checkProtocolRelativeUrls($, filePath, issues);

  return issues;
}

async function lintManifest(filePath) {
  const issues = [];
  const contents = await readFile(filePath, 'utf8');
  let manifest;

  ensure(
    path.extname(filePath) === '.json',
    `${filePath}: expected a .json manifest file`,
    issues,
  );

  try {
    manifest = JSON.parse(contents);
  } catch (error) {
    issues.push(`${filePath}: invalid JSON (${error.message})`);
    return issues;
  }

  ensure(
    typeof manifest === 'object' &&
      manifest !== null &&
      !Array.isArray(manifest),
    `${filePath}: manifest root must be an object`,
    issues,
  );

  ensure(
    manifest?.manifest_version === 3,
    `${filePath}: expected manifest_version to be 3`,
    issues,
  );

  ensure(
    typeof manifest?.name === 'string' && manifest.name.trim().length > 0,
    `${filePath}: expected name to be a non-empty string`,
    issues,
  );

  ensure(
    typeof manifest?.description === 'string' &&
      manifest.description.trim().length > 0,
    `${filePath}: expected description to be a non-empty string`,
    issues,
  );

  ensure(
    typeof manifest?.background?.service_worker === 'string' &&
      manifest.background.service_worker.trim().length > 0,
    `${filePath}: expected background.service_worker to be set`,
    issues,
  );

  ensure(
    typeof manifest?.action?.default_popup === 'string' &&
      manifest.action.default_popup.trim().length > 0,
    `${filePath}: expected action.default_popup to be set`,
    issues,
  );

  ensure(
    typeof manifest?.icons?.['48'] === 'string' &&
      typeof manifest?.icons?.['128'] === 'string',
    `${filePath}: expected icons.48 and icons.128 to be set`,
    issues,
  );

  return issues;
}

async function main() {
  const [, , mode, ...files] = process.argv;

  if (!['html', 'manifest'].includes(mode) || files.length === 0) {
    fail('Usage: node tools/lint-web.mjs <html|manifest> <file...>');
    process.exitCode = 1;
    return;
  }

  const issueLists =
    mode === 'html'
      ? await Promise.all(files.map(lintHtml))
      : await Promise.all(files.map(lintManifest));
  const issues = issueLists.flat();

  if (issues.length > 0) {
    for (const issue of issues) {
      fail(issue);
    }

    process.exitCode = 1;
    return;
  }

  ok(
    `Validated ${files.length} ${mode === 'html' ? 'HTML' : 'manifest'} file(s)`,
  );
}

await main();
