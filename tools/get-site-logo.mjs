#!/usr/bin/env node
/* eslint-env node */
/* global process, Buffer */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable max-len */
/**
 * get-site-logo.mjs
 *
 * Usage:
 *   node get-site-logo.mjs example.com ./output.png
 *   node get-site-logo.mjs --bulk [psps.json] [--start <name|index>]
 *
 * Requires:
 *   npm i sharp cheerio
 *
 * - Targets square icons >= 128x128 from: <link rel="icon">, <link
 *   rel="shortcut icon">, apple-touch icons, PWA manifest icons, common icon
 *   paths (android-chrome-512x512.png, etc.), and OG image metadata.
 * - Also tries third-party favicon APIs: Google and DuckDuckGo.
 * - No heuristic scoring or scanning of all <img> elements/social links—only
 *   metadata and common paths.
 * - Requires icons to be square (or within 5% aspect tolerance) and at least
 *   128x128. No bitmap upscaling.
 * - Outputs a lossless PNG (compressionLevel=9) at exactly 128x128 (downscale
 *   only; never enlarge bitmaps).
 * - Node 18+ recommended (for global fetch).
 * - Bulk mode processes all PSPs and Orchestrators from psps.json and updates
 *   images in assets/images/
 */

import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as path from 'node:path';
import * as cheerio from 'cheerio';

// sharp is ESM-only; dynamic import keeps this file standalone
const sharp = (await import('sharp')).default;

// Be conservative to avoid native crashes under load
sharp.cache(false);
sharp.concurrency(1);

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36';
const TIMEOUT_MS = 12000;
const MEASURE_CONCURRENCY = 1; // extra-safe for sharp/libvips stability
const MIN_SIZE = 128;

// Verbose mode (bulk only by default). Enable via --verbose or LOGO_VERBOSE=1
const ARGS = process.argv.slice(2);

// Note: Bulk mode no longer alters logging; keeping single flag here for potential future use
// (previous BULK_MODE used to gate verbosity). Removing to satisfy lint.
const VERBOSE = ARGS.includes('--verbose') || process.env.LOGO_VERBOSE === '1';
const vlog = (...args) => {
  if (VERBOSE) console.log('[v]', ...args);
};

// Third-party favicon endpoints
const GOOGLE_FAVICON = domain =>
  `https://s2.googleusercontent.com/s2/favicons?domain=${encodeURIComponent(
    domain,
  )}&sz=128`;
const DUCK_FAVICON = domain =>
  `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;

const COMMON_ICON_PATHS = [
  '/android-chrome-192x192.png',
  '/android-chrome-256x256.png',
  '/android-chrome-384x384.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon-152x152.png',
  '/apple-touch-icon-167x167.png',
  '/apple-touch-icon-180x180.png',
  '/apple-touch-icon-precomposed.png',
  '/apple-touch-icon.png',
  '/favicon-194x194.png',
  '/favicon-196x196.png',
  '/favicon.ico',
  '/favicon.png',
  '/favicon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-256x256.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
  '/mstile-150x150.png',
  '/site.webmanifest',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toAbsolute(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stripHttpScheme(input) {
  if (input.startsWith('https://')) return input.slice('https://'.length);
  if (input.startsWith('http://')) return input.slice('http://'.length);
  return input;
}

function stripTrailingSlashes(input) {
  let out = input;
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function pickOutputPath(domainArg, outArg) {
  const cleaned = stripTrailingSlashes(stripHttpScheme(domainArg));
  const base =
    outArg ||
    `${cleaned || 'logo'}.png`;
  return path.resolve(process.cwd(), base);
}

function domainToBases(domain) {
  let host = domain.trim();
  if (!/^https?:\/\//i.test(host)) host = 'https://' + host;
  const u = new URL(host);
  const origin = u.origin;
  const httpOrigin = origin.replace(/^https:/, 'http:');
  return [origin.endsWith('/') ? origin : origin + '/', httpOrigin + '/'];
}

async function fetchText(url, { timeout = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return { ok: true, text, status: res.status, url: res.url };
  } catch (e) {
    return { ok: false, error: e, url };
  } finally {
    clearTimeout(id);
  }
}

async function fetchBuffer(url, { timeout = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      buffer: buf,
      status: res.status,
      url: res.url,
      headers: res.headers,
    };
  } catch (e) {
    return { ok: false, error: e, url };
  } finally {
    clearTimeout(id);
  }
}

function parseSizes(sizesAttr) {
  if (!sizesAttr) return [];
  return sizesAttr
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = /^(\d+)x(\d+)$/i.exec(s);
      if (!m) return null;
      return { w: Number.parseInt(m[1], 10), h: Number.parseInt(m[2], 10) };
    })
    .filter(size => size !== null);
}

function uniq(arr) {
  return [...new Map(arr.map(a => [a.url, a])).values()];
}

function isSquareish(w, h, tolerance = 0.05) {
  if (!w || !h) return false;
  return Math.abs(w - h) / Math.max(w, h) <= tolerance;
}

// Infer declared size(s) from a URL or its query string
function inferSizesFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const params = u.searchParams;
    const sizes = [];

    // Google favicon style ?sz=128
    const sz = params.get('sz');
    if (sz && /^\d{2,4}$/.test(sz)) {
      const n = Number.parseInt(sz, 10);
      if (n > 0) sizes.push({ w: n, h: n });
    }

    // Generic ?w=..&h=..
    const qw = params.get('w');
    const qh = params.get('h');
    if (qw && qh && /^\d{2,4}$/.test(qw) && /^\d{2,4}$/.test(qh)) {
      sizes.push({ w: Number.parseInt(qw, 10), h: Number.parseInt(qh, 10) });
    }

    // Filename patterns like -152x152 or _128x128
    const name = (u.pathname.split('/').pop() || '').toLowerCase();
    const m = /(\d{2,4})x(\d{2,4})(?=\D|$)/i.exec(name);
    if (m) {
      const w = Number.parseInt(m[1], 10);
      const h = Number.parseInt(m[2], 10);
      if (w > 0 && h > 0) sizes.push({ w, h });
    }

    return sizes;
  } catch {
    return [];
  }
}

function allSizesBelowMin(sizes) {
  if (!sizes || !sizes.length) return false; // unknown sizes -> keep
  return sizes.every(s => Math.min(s.w || 0, s.h || 0) < MIN_SIZE);
}

function candidateBelowMinByDeclaration(cand) {
  const declared = Array.isArray(cand.declaredSizes) ? cand.declaredSizes : [];
  const fromUrl = inferSizesFromUrl(cand.url || '');
  const combined = [...declared, ...fromUrl];
  if (!combined.length) return false; // unknown sizes -> keep
  return allSizesBelowMin(combined);
}

function candidateMeetsMinByDeclaration(cand) {
  return !candidateBelowMinByDeclaration(cand);
}

function extractDomain(input) {
  try {
    const url = input.startsWith('http') ? input : `https://${input}`;
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return (input || '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  }
}

async function getImageMeta(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return {
      format: (meta.format || '').toLowerCase(),
      width: meta.width || 0,
      height: meta.height || 0,
      hasAlpha: !!meta.hasAlpha,
    };
  } catch {
    return null;
  }
}

// Lightweight magic-number sniff to avoid feeding HTML/JSON into sharp
function sniffImageFormat(buffer, contentType = '', url = '') {
  try {
    if (!buffer || buffer.length < 4) return 'unknown';

    const ct = (contentType || '').toLowerCase();
    const fromCt = sniffFromContentType(ct);
    if (fromCt) return fromCt;

    const fromMagic = sniffFromMagicNumbers(buffer);
    if (fromMagic) return fromMagic;

    const fromSvg = sniffFromSvgHead(buffer);
    if (fromSvg) return fromSvg;

    const fromUrl = sniffFromUrlExtension(url);
    if (fromUrl) return fromUrl;

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function sniffFromContentType(ct) {
  if (!ct || !ct.startsWith('image/')) return null;

  if (ct.includes('svg')) return 'svg';
  if (ct.includes('icon') || ct.includes('x-icon') || ct.includes('vnd.microsoft.icon')) return 'ico';
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('avif')) return 'avif';

  // unknown image/* -> let sharp try
  return 'image';
}

function sniffFromMagicNumbers(buffer) {
  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'png';

  // JPG
  if (b0 === 0xff && b1 === 0xd8) return 'jpeg';

  // GIF
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return 'gif';

  // WEBP (RIFF....WEBP)
  if (buffer.length >= 12) {
    const riff = buffer.slice(0, 4).toString('ascii');
    const webp = buffer.slice(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  }

  // ICO: 00 00 01 00
  if (b0 === 0x00 && b1 === 0x00 && b2 === 0x01 && b3 === 0x00) return 'ico';

  return null;
}

function sniffFromSvgHead(buffer) {
  const head = buffer.slice(0, Math.min(512, buffer.length)).toString('utf8').toLowerCase();
  return head.includes('<svg') ? 'svg' : null;
}

function sniffFromUrlExtension(url) {
  const lowerUrl = (url || '').toLowerCase();
  return /[.](png|jpe?g|gif|webp|avif|ico|svg)(\?|#|$)/.test(lowerUrl) ? 'image' : null;
}

async function tryManifestIcons(manifestUrl, base) {
  const out = [];
  const txt = await fetchText(manifestUrl);
  if (!txt.ok) return out;
  let json;
  try {
    json = JSON.parse(txt.text);
  } catch {
    return out;
  }

  const icons = Array.isArray(json.icons) ? json.icons : [];
  for (const icon of icons) {
    if (!icon || !icon.src) continue;
    const abs = toAbsolute(icon.src, txt.url || base);
    if (!abs) continue;
    const declaredSizes = parseSizes(icon.sizes);
    const cand = {
      url: abs,
      source: 'manifest-icon',
      declaredSizes,
      purpose: icon.purpose,
      type: icon.type,
    };
    if (candidateBelowMinByDeclaration(cand)) {
      vlog(`prefilter(manifest): drop < ${MIN_SIZE}px ${abs}`);
      continue;
    }

    out.push(cand);
  }

  return out;
}

function collectFromDom($, baseUrl) {
  const cands = [];

  // <link rel="...">
  $('link[rel*="icon"], link[rel="mask-icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each(
    (_, el) => {
      const rel = ($(el).attr('rel') || '').toLowerCase();
      const href = $(el).attr('href');
      if (!href) return;
      const sizes = parseSizes($(el).attr('sizes'));
      const abs = toAbsolute(href, baseUrl);
      if (!abs) return;
      let source = 'icon';
      if (rel.includes('apple-touch')) source = 'apple-touch-icon';
      else if (rel.includes('mask-icon')) source = 'mask-icon';
      const cand = { url: abs, source, declaredSizes: sizes };
      if (candidateMeetsMinByDeclaration(cand)) {
        cands.push(cand);
      } else {
        vlog(`prefilter(dom): drop < ${MIN_SIZE}px ${abs}`);
      }
    },
  );

  // Manifest
  const manifestHref = $('link[rel="manifest"]').attr('href');
  if (manifestHref) {
    const abs = toAbsolute(manifestHref, baseUrl);
    if (abs) cands.push({ url: abs, source: 'manifest-link' });
  }

  // OG image
  const og = $('meta[property="og:image"]').attr('content');
  if (og) {
    const abs = toAbsolute(og, baseUrl);
    if (abs) {
      const cand = { url: abs, source: 'og-image' };
      if (candidateMeetsMinByDeclaration(cand)) {
        cands.push(cand);
      } else {
        vlog(`prefilter(dom-og): drop < ${MIN_SIZE}px ${abs}`);
      }
    }
  }

  return cands;
}

async function collectCandidatesForBase(baseUrl) {
  const cands = [];

  // Homepage parse
  const html = await fetchText(baseUrl);
  if (html.ok) {
    const $ = cheerio.load(html.text);
    const fromDom = collectFromDom($, html.url || baseUrl);
    cands.push(...fromDom);

    // If manifest link present, fetch icons from it
    const manifest = fromDom.find((x) => x.source === 'manifest-link');
    if (manifest) {
      const minis = await tryManifestIcons(manifest.url, html.url || baseUrl);
      cands.push(...minis);
    }
  }

  // Guess common icon paths
  for (const p of COMMON_ICON_PATHS) {
    const abs = toAbsolute(p, baseUrl);
    if (!abs) continue;
    const source = p.endsWith('.json') || p.endsWith('manifest') ? 'manifest-link' : 'guess-path';
    const cand = { url: abs, source };
    if (source === 'manifest-link' || !candidateBelowMinByDeclaration(cand)) {
      cands.push(cand);
    } else {
      vlog(`prefilter(common): drop < ${MIN_SIZE}px ${abs}`);
    }
  }

  return uniq(cands);
}

async function probeCandidate(c) {
  // If this is a manifest link, expand it to icons
  if (c.source === 'manifest-link') {
    const icons = await tryManifestIcons(c.url, c.url);
    return icons.map((i) => ({ ...i }));
  }

  return [c];
}

async function fetchAndMeasure(cand) {
  const res = await fetchBuffer(cand.url);
  if (!res.ok) return null;

  // Skip obvious non-images before calling sharp to avoid native crashes
  const contentType = res.headers?.get ? (res.headers.get('content-type') || '') : '';
  const sniff = sniffImageFormat(res.buffer, contentType, cand.url);
  if (sniff === 'unknown') {
    vlog(`sniff drop (${cand.source || 'n/a'}): ${cand.url} ct=${contentType}`);
    return null;
  }

  const meta = await getImageMeta(res.buffer);
  if (!meta) return null;

  // Some paths may be JSON (manifest) or HTML — filter out non-image content
  if (!meta.width && !/svg|ico|png|jpe?g|webp|gif|avif/i.test(meta.format || '')) {
    return null;
  }

  const enriched = {
    ...cand,
    buffer: res.buffer,
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || '',
    hasAlpha: meta.hasAlpha || false,
  };

  // ICO may embed multiple sizes; sharp reports the largest “page”. Good enough.

  return enriched;
}

async function withLimit(concurrency, items, worker) {
  const ret = [];
  let i = 0;
  const running = new Set();

  async function runOne(idx) {
    const p = (async() => worker(items[idx]))().then(
      (r) => ({ i: idx, r }),
      (e) => ({ i: idx, r: null, e }),
    );
    running.add(p);
    const { r } = await p;
    running.delete(p);
    ret[idx] = r;
  }

  while (i < items.length || running.size) {
    while (i < items.length && running.size < concurrency) {
      runOne(i++);
    }

    if (running.size) await Promise.race(running);
  }

  return ret;
}

async function processLogoForPSP(psp, assetsDir) {
  if (!psp.url || !psp.image) {
    console.log(`⚠️  Skipping ${psp.name}: missing url or image field`);
    return { psp: psp.name, status: 'skipped', reason: 'missing url or image' };
  }

  const outputPath = path.join(assetsDir, `${psp.image}.png`);

  try {
    console.log(`🔍 Processing ${psp.name} (${psp.url})...`);

    const domain = extractDomain(psp.url);
    const bases = domainToBases(psp.url);
    const isAcceptable = (m) => isAcceptableIconCandidate(m);

    const metaResult = await tryWriteFromMetadataCandidates(psp.name, bases, outputPath, isAcceptable);
    if (metaResult) return metaResult;

    const commonResult = await tryWriteFromCommonPaths(psp.name, bases, outputPath, isAcceptable);
    if (commonResult) return commonResult;

    const thirdPartyResult = await tryWriteFromThirdParty(psp.name, domain, outputPath, isAcceptable);
    if (thirdPartyResult) return thirdPartyResult;

    console.log(`❌ ${psp.name}: No acceptable icons (>=128px and square-ish)`);
    return { psp: psp.name, status: 'failed', reason: 'no acceptable icons' };
  } catch (error) {
    console.log(`❌ ${psp.name}: Error - ${error.message}`);
    return { psp: psp.name, status: 'error', reason: error.message };
  }
}

async function tryWriteFromMetadataCandidates(pspName, bases, outputPath, isAcceptable) {
  const metaCands = await collectMetaCandidates(bases);
  vlog(`${pspName}: meta candidates found = ${metaCands.length}`);

  const unique = await expandAndUniqCandidates(metaCands);
  vlog(`${pspName}: unique metadata candidates=${unique.length}`);

  const measured = (await withLimit(MEASURE_CONCURRENCY, unique, fetchAndMeasure)).filter(isAcceptable);
  vlog(`${pspName}: meta measured acceptable = ${measured.length}`);
  return await writeBestMeasured(pspName, measured, outputPath);
}

async function tryWriteFromCommonPaths(pspName, bases, outputPath, isAcceptable) {
  const commonCands = collectCommonPathCandidates(bases);
  vlog(`${pspName}: trying common paths (${commonCands.length})`);

  const expanded = (await Promise.all(uniq(commonCands).map(c => probeCandidate(c)))).flat().filter(Boolean);
  const measured = (await withLimit(MEASURE_CONCURRENCY, expanded, fetchAndMeasure)).filter(isAcceptable);
  vlog(`${pspName}: common measured acceptable = ${measured.length}`);
  return await writeBestMeasured(pspName, measured, outputPath);
}

async function tryWriteFromThirdParty(pspName, domain, outputPath, isAcceptable) {
  const thirdParty = [
    { url: GOOGLE_FAVICON(domain), source: 'google-favicon' },
    { url: DUCK_FAVICON(domain), source: 'duckduckgo-favicon' },
  ];
  vlog(`${pspName}: falling back to third-party favicons`);

  const measured = (await withLimit(MEASURE_CONCURRENCY, thirdParty, fetchAndMeasure)).filter(isAcceptable);
  return await writeBestMeasured(pspName, measured, outputPath);
}

async function collectMetaCandidates(bases) {
  const metaCands = [];
  for (const base of bases) {
    const got = await collectCandidatesForBase(base).catch(() => []);
    metaCands.push(...got);
  }

  return metaCands;
}

async function expandAndUniqCandidates(candidates) {
  const expanded = (await Promise.all(candidates.map(c => probeCandidate(c)))).flat().filter(Boolean);
  return uniq(expanded.filter(isValidUrlCandidate));
}

function isValidUrlCandidate(c) {
  try {
    new URL(c.url);
    return true;
  } catch {
    return false;
  }
}

function collectCommonPathCandidates(bases) {
  const commonCands = [];
  for (const base of bases) {
    for (const p of COMMON_ICON_PATHS) {
      const abs = toAbsolute(p, base);
      if (!abs) continue;
      const cand = { url: abs, source: p.endsWith('.json') || p.endsWith('manifest') ? 'manifest-link' : 'guess-path' };
      if (cand.source === 'manifest-link' || !candidateBelowMinByDeclaration(cand)) {
        commonCands.push(cand);
      } else {
        vlog(`prefilter(common-bulk): drop < ${MIN_SIZE}px ${abs}`);
      }
    }
  }

  return commonCands;
}

function isAcceptableIconCandidate(m) {
  if (!m) return false;
  const w = m.width || 0;
  const h = m.height || 0;
  const fmt = (m.format || '').toLowerCase();
  const isRaster = ['png', 'webp', 'jpg', 'jpeg', 'ico', 'gif', 'avif'].includes(fmt);

  if (!isRaster && fmt !== 'svg') return false;
  if (fmt === 'svg' && (!w || !h)) return false;
  if (Math.min(w, h) < MIN_SIZE) return false;
  return isSquareish(w, h, 0.05);
}

async function writeBestMeasured(pspName, measured, outputPath) {
  if (!measured || measured.length === 0) return null;

  const best = measured.sort(
    (a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height),
  )[0];

  await writeOut128(best.buffer, outputPath, best.format);
  console.log(`✅ ${pspName}: Updated ${outputPath} (${best.source}, ${best.width}x${best.height})`);

  return {
    psp: pspName,
    status: 'success',
    output: outputPath,
    source: best.source,
    dimensions: `${best.width}x${best.height}`,
    format: best.format,
  };
}

async function writeOut128(inputBuffer, outputPath, fmt) {
  const base = createSharpBase(inputBuffer, fmt);
  const analysis = await analyzeForWriteOut128(base, outputPath, fmt);
  const output = buildWriteOut128Pipeline(base, analysis);
  await writeOut128ToFile(output, inputBuffer, outputPath);
}

function createSharpBase(inputBuffer, fmt) {
  const svg = (fmt || '').toLowerCase() === 'svg';
  return svg ? sharp(inputBuffer, { density: 512 }) : sharp(inputBuffer, { animated: false });
}

async function analyzeForWriteOut128(base, outputPath, fmt) {
  const analysisPipe = base
    .clone()
    .resize(MIN_SIZE, MIN_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .ensureAlpha();

  const { data, info } = await analysisPipe.raw().toBuffer({ resolveWithObject: true });
  const stats = computeWriteOut128Stats(data, info);

  const avgLum = stats.alphaSum > 0 ? stats.lumSum / stats.alphaSum : 255;
  const bgIsBlack = avgLum >= 128;
  const hasTransparency = stats.transparentCount / stats.len > 0.02;

  const cornerArea = stats.cornerSize * stats.cornerSize;
  const tlFrac = stats.transTL / cornerArea;
  const trFrac = stats.transTR / cornerArea;
  const blFrac = stats.transBL / cornerArea;
  const brFrac = stats.transBR / cornerArea;
  const innerShare = stats.transStrictTotal > 0 ? (stats.innerStrict / stats.transStrictTotal) : 0;
  const fourCornersTransparent = tlFrac >= 0.2 && trFrac >= 0.2 && blFrac >= 0.2 && brFrac >= 0.2;

  const cornerOnlyTransparency = hasTransparency && fourCornersTransparent && innerShare <= 0.05;
  const shouldHandleTransparency = hasTransparency && !cornerOnlyTransparency;

  const desiredPad = 16;
  const bgColor = bgIsBlack ? { r: 18, g: 18, b: 18 } : { r: 255, g: 255, b: 255 };

  let scale = 1;
  if (shouldHandleTransparency && stats.maxX >= 0 && stats.maxY >= 0) {
    const contentW = Math.max(1, (stats.maxX - stats.minX + 1));
    const contentH = Math.max(1, (stats.maxY - stats.minY + 1));
    const targetInner = MIN_SIZE - 2 * desiredPad;
    if (contentW > targetInner || contentH > targetInner) {
      scale = Math.min(1, targetInner / Math.max(contentW, contentH));
    }
  }

  const target = Math.round(MIN_SIZE * scale);
  const padLeft = Math.floor((MIN_SIZE - target) / 2);
  const padTop = Math.floor((MIN_SIZE - target) / 2);
  const padRight = MIN_SIZE - target - padLeft;
  const padBottom = MIN_SIZE - target - padTop;
  const padBg = shouldHandleTransparency ? bgColor : { r: 0, g: 0, b: 0, alpha: 0 };

  let bgLabel = 'transparent';
  if (shouldHandleTransparency) {
    bgLabel = bgIsBlack ? 'black' : 'white';
  }

  vlog(
    `writeOut128 ${path.basename(outputPath)}: fmt=${fmt}, size=${stats.w}x${stats.h}, ` +
      `avgLum=${Math.round(avgLum)}, hasAlpha=${hasTransparency}, ` +
      `cornersOK=${fourCornersTransparent}, innerShare=${(innerShare * 100).toFixed(1)}%, ` +
      `cornerOnly=${cornerOnlyTransparency}, handleTransparency=${shouldHandleTransparency}, ` +
      `scale=${scale.toFixed(2)}, padL/T=${padLeft}/${padTop}, bg=${bgLabel}`,
  );

  return {
    bgColor,
    shouldHandleTransparency,
    scale,
    padLeft,
    padRight,
    padTop,
    padBottom,
    padBg,
  };
}

function computeWriteOut128Stats(data, info) {
  const channels = info.channels || 4;
  const w = info.width;
  const h = info.height;
  const cornerSize = Math.max(6, Math.round(Math.min(w, h) * 0.12));
  const len = w * h;

  const state = {
    lumSum: 0,
    alphaSum: 0,
    transparentCount: 0,
    minX: w,
    minY: h,
    maxX: -1,
    maxY: -1,
    transTL: 0,
    transTR: 0,
    transBL: 0,
    transBR: 0,
    transStrictTotal: 0,
    innerStrict: 0,
  };

  for (let i = 0; i < len; i++) {
    const idx = i * channels;
    const r = data[idx + 0];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = channels > 3 ? data[idx + 3] : 255;
    const x = i % w;
    const yIdx = Math.trunc(i / w);

    updateTransparencyCounters(state, a);
    updateLumaAndBounds(state, r, g, b, a, x, yIdx);
    updateStrictTransparency(state, a, x, yIdx, cornerSize, w, h);
  }

  return {
    channels,
    w,
    h,
    cornerSize,
    len,
    ...state,
  };
}

function updateTransparencyCounters(state, a) {
  if (a < 250) state.transparentCount++;
}

function updateLumaAndBounds(state, r, g, b, a, x, yIdx) {
  if (a <= 10) return;

  const al = a / 255;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  state.lumSum += y * al;
  state.alphaSum += al;

  if (x < state.minX) state.minX = x;
  if (x > state.maxX) state.maxX = x;
  if (yIdx < state.minY) state.minY = yIdx;
  if (yIdx > state.maxY) state.maxY = yIdx;
}

function updateStrictTransparency(state, a, x, yIdx, cornerSize, w, h) {
  if (a >= 200) return;

  state.transStrictTotal++;

  const inTL = x < cornerSize && yIdx < cornerSize;
  const inTR = x >= (w - cornerSize) && yIdx < cornerSize;
  const inBL = x < cornerSize && yIdx >= (h - cornerSize);
  const inBR = x >= (w - cornerSize) && yIdx >= (h - cornerSize);

  if (inTL) state.transTL++;
  else if (inTR) state.transTR++;
  else if (inBL) state.transBL++;
  else if (inBR) state.transBR++;
  else updateInnerStrict(state, x, yIdx, cornerSize, w, h);
}

function updateInnerStrict(state, x, yIdx, cornerSize, w, h) {
  const inTop = yIdx < cornerSize;
  const inBottom = yIdx >= (h - cornerSize);
  const inLeft = x < cornerSize;
  const inRight = x >= (w - cornerSize);
  if (!(inTop || inBottom || inLeft || inRight)) state.innerStrict++;
}

function buildWriteOut128Pipeline(base, analysis) {
  const { bgColor, shouldHandleTransparency, scale, padLeft, padRight, padTop, padBottom, padBg } = analysis;
  const targetSize = Math.round(MIN_SIZE * scale);

  let output;
  if (shouldHandleTransparency) {
    output = base
      .clone()
      .flatten({ background: bgColor })
      .resize(targetSize, targetSize, {
        fit: 'contain',
        background: bgColor,
        withoutEnlargement: true,
      });
  } else {
    output = base
      .clone()
      .ensureAlpha()
      .resize(targetSize, targetSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: true,
      });
  }

  return output.extend({ top: padTop, bottom: padBottom, left: padLeft, right: padRight, background: padBg });
}

async function writeOut128ToFile(output, inputBuffer, outputPath) {
  try {
    await output
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .withMetadata({})
      .toFile(outputPath);
  } catch {
    await sharp(inputBuffer)
      .resize(MIN_SIZE, MIN_SIZE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 }, withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
  }
}

async function processBulk(pspsJsonPath = './public/psps.json', startFrom = undefined) {
  const assetsDir = path.resolve('./assets/images');

  try {
    // Read PSPs data
    const pspsData = JSON.parse(await readFile(path.resolve(pspsJsonPath), 'utf8'));
    const psps = Array.isArray(pspsData.psps) ? pspsData.psps : [];
    const orchestrators = (pspsData.orchestrators && Array.isArray(pspsData.orchestrators.list))
      ? pspsData.orchestrators.list
      : [];

    // Combine PSPs + Orchestrators and run in alphabetical order by name
    const providers = [...psps, ...orchestrators].sort((a, b) => {
      const an = (a?.name || '').toLowerCase();
      const bn = (b?.name || '').toLowerCase();
      return an.localeCompare(bn);
    });

    // Determine start index if provided
    const { startIndex, startHint } = resolveStartIndex(providers, startFrom);

    const providersToProcess = providers.slice(startIndex);

    console.log(`🚀 Processing ${providersToProcess.length} providers (PSPs + orchestrators) from ${pspsJsonPath}`);
    if (startIndex > 0) {
      const startAt = startHint || `index ${startIndex + 1}`;
      console.log(`⏩ Starting at ${startAt}: ${providers[startIndex]?.name || 'unknown'}`);
    }

    console.log(`📁 Output directory: ${assetsDir}`);
    if (VERBOSE) {
      console.log(
        `🔧 Settings: concurrency=1, timeout=${TIMEOUT_MS}ms, MIN_SIZE=${MIN_SIZE}, UA=${UA.split(' ').slice(-2).join(' ')}`,
      );

      console.log('ℹ️ Verbose mode enabled for bulk runs');
    }

    console.log('');

    // Process providers with limited concurrency to be respectful to websites
    const indexed = providersToProcess.map((psp, i) => ({ psp, i: startIndex + i }));
    const total = providers.length;
    const results = await withLimit(1, indexed, async({ psp, i }) => {
      console.log(`▶️  [${i + 1}/${total}] ${psp.name}`);
      const result = await processLogoForPSP(psp, assetsDir);
      if (result?.status !== 'success') {
        vlog(`${psp.name}: status=${result?.status}, reason=${result?.reason || 'n/a'}`);
      }

      await sleep(1000); // Be respectful - 1 second delay between requests
      return result;
    });

    // Summary
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed');
    const skipped = results.filter(r => r.status === 'skipped');
    const errors = results.filter(r => r.status === 'error');

    console.log('\n📊 Summary:');
    console.log(`✅ Successful: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    console.log(`⚠️  Skipped: ${skipped.length}`);
    console.log(`💥 Errors: ${errors.length}`);

    if (failed.length > 0) {
      console.log('\n❌ Failed providers:');
      failed.forEach(r => console.log(`  - ${r.psp}: ${r.reason}`));
    }

    if (errors.length > 0) {
      console.log('\n💥 Error providers:');
      errors.forEach(r => console.log(`  - ${r.psp}: ${r.reason}`));
    }

    return results;

  } catch (error) {
    console.error(`Failed to process bulk: ${error.message}`);
    process.exit(1);
  }
}

function resolveStartIndex(providers, startFrom) {
  let startIndex = 0;
  let startHint = '';

  if (startFrom && typeof startFrom === 'string') {
    const s = startFrom.trim();
    if (/^\d+$/.test(s)) {
      const idx = Math.max(0, Math.min(providers.length - 1, Number.parseInt(s, 10) - 1));
      startIndex = idx;
      startHint = `index ${idx + 1}`;
    } else {
      const needle = s.toLowerCase();
      let idx = providers.findIndex(p => (p?.name || '').toLowerCase() === needle);
      if (idx < 0) {
        idx = providers.findIndex(p => (p?.name || '').toLowerCase().startsWith(needle));
      }

      if (idx >= 0) {
        startIndex = idx;
        startHint = `name "${providers[idx].name}"`;
      } else {
        console.warn(`⚠️  --start '${startFrom}' not found; starting from the beginning.`);
      }
    }
  }

  return { startIndex, startHint };
}

async function main() {
  const args = process.argv.slice(2);

  const mode = parseCliMode(args);
  if (mode.kind === 'bulk') {
    await processBulk(mode.pspsArg, mode.startFrom);
    return;
  }

  await runSingleSiteMode(mode);
}

function parseCliMode(args) {
  if (args.includes('--bulk')) {
    const bulkIndex = args.indexOf('--bulk');
    const after = args.slice(bulkIndex + 1);
    const pspsArg = after.find(a => !a.startsWith('--')) || './public/psps.json';

    const startIdx = args.indexOf('--start');
    const val = startIdx >= 0 ? args[startIdx + 1] : undefined;
    const startFrom = val && !val.startsWith('--') ? val : undefined;

    return { kind: 'bulk', pspsArg, startFrom };
  }

  const positional = args.filter(a => !a.startsWith('--'));
  const domainArg = positional[0];
  const outArg = positional[1];
  return { kind: 'single', domainArg, outArg };
}

async function runSingleSiteMode(mode) {
  const domainArg = mode.domainArg;
  const outArg = mode.outArg;
  if (!domainArg) {
    console.error('Usage: node get-site-logo.mjs <domain-or-url> [output.png] [--verbose]');
    console.error('       node get-site-logo.mjs --bulk [psps.json] [--start <name|index>] [--verbose]');
    process.exit(1);
  }

  const outPath = pickOutputPath(domainArg, outArg);
  const domain = extractDomain(domainArg);
  const bases = domainToBases(domainArg);
  const isAcceptable = (m) => isAcceptableIconCandidate(m);

  const metaResult = await tryWriteSingleFromMetadata(bases, outPath, isAcceptable);
  if (metaResult) return;

  const commonResult = await tryWriteSingleFromCommonPaths(bases, outPath, isAcceptable);
  if (commonResult) return;

  await writeSingleFromThirdParty(domain, outPath, isAcceptable);
}

async function tryWriteSingleFromMetadata(bases, outPath, isAcceptable) {
  const metaCands = await collectMetaCandidates(bases);
  const unique = await expandAndUniqCandidates(metaCands);
  const measured = (await withLimit(MEASURE_CONCURRENCY, unique, fetchAndMeasure)).filter(isAcceptable);
  return await writeSingleChoiceOrNull(measured, outPath);
}

async function tryWriteSingleFromCommonPaths(bases, outPath, isAcceptable) {
  const common = [];
  for (const base of bases) {
    for (const p of COMMON_ICON_PATHS) {
      const abs = toAbsolute(p, base);
      if (!abs) continue;
      const cand = { url: abs, source: p.endsWith('.json') || p.endsWith('manifest') ? 'manifest-link' : 'guess-path' };
      if (cand.source === 'manifest-link' || candidateMeetsMinByDeclaration(cand)) {
        common.push(cand);
      } else if (VERBOSE) {
        console.log(`[v] prefilter(common-single): drop < ${MIN_SIZE}px ${abs}`);
      }
    }
  }

  const measured = (await withLimit(MEASURE_CONCURRENCY, uniq(common), fetchAndMeasure)).filter(isAcceptable);
  return await writeSingleChoiceOrNull(measured, outPath);
}

async function writeSingleFromThirdParty(domain, outPath, isAcceptable) {
  const tp = [
    { url: GOOGLE_FAVICON(domain), source: 'google-favicon' },
    { url: DUCK_FAVICON(domain), source: 'duckduckgo-favicon' },
  ];
  const measured = (await withLimit(MEASURE_CONCURRENCY, tp, fetchAndMeasure)).filter(isAcceptable);
  const wrote = await writeSingleChoiceOrNull(measured, outPath);
  if (wrote) return;

  console.error('No acceptable icons (>=128px and square-ish).');
  process.exit(3);
}

async function writeSingleChoiceOrNull(measured, outPath) {
  const best = pickBestMeasured(measured);
  if (!best) return false;

  await writeOut128(best.buffer, outPath, best.format);
  console.log(JSON.stringify({
    output: outPath,
    chosen: { url: best.url, source: best.source, width: best.width, height: best.height, format: best.format },
  }, null, 2));

  return true;
}

function pickBestMeasured(measured) {
  if (!measured || measured.length === 0) return null;
  return measured.sort((a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height))[0];
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(10);
}
