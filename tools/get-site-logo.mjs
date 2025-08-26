#!/usr/bin/env node
/* eslint-env node */
/* global process, Buffer */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable lines-around-comment */
/* eslint-disable no-empty */
/* eslint-disable max-len */
/**
 * get-site-logo.mjs
 *
 * Usage:
 *   node get-site-logo.mjs example.com ./output.png
 *   node get-site-logo.mjs --bulk [psps.json]
 *
 * Requires:
 *   npm i sharp cheerio
 *
 * Notes:
 * - Targets square icons >= 128x128 from: <link rel="icon">, apple-touch icons, PWA manifest,
 *   common icon paths (android-chrome-512x512.png, etc.), on-page <img> logos, OG/Twitter image,
 *   and (best-effort) official social links it finds on the homepage (LinkedIn, Facebook, Instagram, X/Twitter).
 * - Picks the "best" candidate by scoring source type, size, format, and squareness.
 * - Outputs a lossless PNG (compressionLevel=9) at exactly 128x128. Non-square inputs are padded (contain) to square.
 * - Node 18+ recommended (for global fetch).
 * - Bulk mode processes all PSPs from psps.json and updates images in assets/images/
 */

import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import * as cheerio from 'cheerio';

// sharp is ESM-only; dynamic import keeps this file standalone
const sharp = (await import('sharp')).default;

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36';
const TIMEOUT_MS = 12000;
const MAX_CONCURRENCY = 5;
const MIN_SIZE = 128;

const SOCIAL_HOSTS = [
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'linkedin.com',
  'www.linkedin.com',
  'twitter.com',
  'x.com',
  'www.twitter.com',
  'www.x.com',
];

const COMMON_ICON_PATHS = [
  '/favicon.ico',
  '/favicon.svg',
  '/favicon.png',
  '/favicon-32x32.png',
  '/favicon-96x96.png',
  '/favicon-194x194.png',
  '/favicon-196x196.png',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/apple-touch-icon-57x57.png',
  '/apple-touch-icon-60x60.png',
  '/apple-touch-icon-72x72.png',
  '/apple-touch-icon-76x76.png',
  '/apple-touch-icon-114x114.png',
  '/apple-touch-icon-120x120.png',
  '/apple-touch-icon-120x120.png',
  '/apple-touch-icon-152x152.png',
  '/apple-touch-icon-167x167.png',
  '/apple-touch-icon-180x180.png',
  '/android-chrome-512x512.png',
  '/android-chrome-384x384.png',
  '/android-chrome-256x256.png',
  '/android-chrome-192x192.png',
  '/mstile-150x150.png',
  '/icons/icon-512x512.png',
  '/icons/icon-384x384.png',
  '/icons/icon-256x256.png',
  '/icons/icon-192x192.png',
  '/site.webmanifest',
  '/manifest.json',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toAbsolute(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function pickOutputPath(domainArg, outArg) {
  const base =
    outArg ||
    `${domainArg.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'logo'}.png`;
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
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
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
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer: buf, status: res.status, url: res.url, headers: res.headers };
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
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d+)x(\d+)$/i.exec(s);
      if (!m) return null;
      return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    })
    .filter(Boolean);
}

function uniq(arr) {
  return [...new Map(arr.map((a) => [a.url, a])).values()];
}

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Extract hostname from a URL string.
 * @param {string} u
 * @returns {string}
 */
function getHostname(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Normalize host for comparisons (drop www.).
 * @param {string} host
 * @returns {string}
 */
function normalizeHost(host) {
  return (host || '').replace(/^www\./, '').toLowerCase();
}

/**
 * Score URL path keywords: boost logo-ish, penalize banner-ish.
 * @param {string} uLower
 * @returns {number}
 */
function keywordScoreForUrl(uLower) {
  // Positive indicators that it's a logo/icon
  const positives = [
    'logo',
    'brand',
    'brandmark',
    'favicon',
    'apple-touch-icon',
    'android-chrome',
    'icon-512',
    'icon-384',
    'icon-256',
    'icon-192',
    'icon-180',
    'icon-167',
    'icon-152',
    'mark',
    'glyph',
    'symbol',
    'logotype',
  ];

  // Negative indicators (common for hero/banners or social share images)
  const negatives = [
    'banner',
    'hero',
    'cover',
    'header',
    'share',
    'social',
    'og',
    'open-graph',
    'twitter',
    'card',
    'twimg',
    'promo',
    'advert',
    'ad-',
    '/ads/',
    'press',
    'news',
    'blog',
    'article',
    'event',
    'conference',
    'screenshot',
    'snapshot',
    'background',
    'wallpaper',
    'brochure',
  ];

  let score = 0;
  if (positives.some((k) => uLower.includes(k))) score += 300;
  if (negatives.some((k) => uLower.includes(k))) score -= 400;
  return score;
}

/**
 * Return true if the candidate likely refers to a third-party brand mark (social/payment badges),
 * which we should exclude from consideration unless it clearly matches the site's own brand
 * in the asset path or the element's alt/title.
 * @param {{url:string, alt?:string, title?:string}} cand
 * @param {string[]} brandWords
 * @returns {boolean}
 */
function isForeignBrandMarkUrl(cand, brandWords) {
  const rawUrl = cand?.url || '';
  let pathLower = rawUrl.toLowerCase();
  try {
    const u = new URL(rawUrl);
    pathLower = (u.pathname + (u.search || '')).toLowerCase();
  } catch {
    // keep full lower URL if not parseable
  }

  const altLower = (cand?.alt || '').toLowerCase();
  const titleLower = (cand?.title || '').toLowerCase();

  // Common social platforms and communities
  const socialTokens = [
    'facebook',
    'instagram',
    'linkedin',
    'twitter',
    'twimg',
    'x-logo',
    'tiktok',
    'youtube',
    'pinterest',
    'github',
    'gitlab',
    'discord',
    'slack',
    'whatsapp',
    'wechat',
    'weixin',
    'telegram',
  ];

  // Common payment method/brand badges often shown on PSP sites
  const paymentTokens = [
    'visa',
    'mastercard',
    'maestro',
    'amex',
    'american-express',
    'diners',
    'discover',
    'jcb',
    'unionpay',
    'rupay',
    'alipay',
    'wechatpay',
    'paypal',
    'apple-pay',
    'google-pay',
    'gpay',
    'klarna',
    'afterpay',
    'affirm',
    'ideal',
    'giropay',
    'bancontact',
    'sofort',
    'przelewy24',
    'eps',
    'pse',
    'pix',
    'boleto',
    'mbway',
    'multibanco',
    'sepa',
    'trustly',
    'swish',
    'vipps',
    'blik',
    'upi',
    'paytm',
    'gcash',
  ];

  // Paths that usually indicate a list of client/partner logos rather than the site's own brand
  const galleryTokens = [
    'clients',
    'customer',
    'customers',
    'partners',
    'partnerships',
    'brands',
    'bigcompanies',
    'case-studies',
    'case_studies',
    'references',
    'portfolio',
    'press-logos',
    '/logos/',
  ];

  // First, exclude obvious galleries and third-party brand tokens regardless of host/brand words
  if (galleryTokens.some((t) => pathLower.includes(t))) return true;
  if (socialTokens.some((t) => pathLower.includes(t))) return true;
  if (paymentTokens.some((t) => pathLower.includes(t))) return true;

  // If the asset path or text includes brand words, treat as first-party; host name alone isn't sufficient
  const hasBrand = brandWords.some((w) => pathLower.includes(w) || altLower.includes(w) || titleLower.includes(w));
  if (hasBrand) return false;
  return false;
}

/**
 * Extract probable brand words from URL and optional display name.
 * @param {string} siteUrl
 * @param {string=} displayName
 * @returns {string[]}
 */
function deriveBrandWords(siteUrl, displayName) {
  const words = new Set();
  try {
    const h = new URL(siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl).hostname;
    const tokens = h
      .toLowerCase()
      .replace(/^www\./, '')
      .split(/[.-]/)
      .filter(Boolean);
    for (const t of tokens) {
      if (t.length >= 3 && !['com', 'net', 'org', 'www'].includes(t)) words.add(t);
    }
  } catch {}

  if (displayName) {
    const nameTokens = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const t of nameTokens) if (t.length >= 3) words.add(t);
  }

  return Array.from(words);
}

/**
 * Penalize extreme aspect ratios (likely banners), heavier for social sources.
 * @param {number} w
 * @param {number} h
 * @param {string} src
 * @returns {number}
 */
function extremeAspectPenalty(w, h, src) {
  if (!w || !h) return 0;
  const a = w / h;

  // Penalize non-square shapes; banners get harsher penalty
  if (a > 3.5 || a < 1 / 3.5) return -1200; // extremely banner-like
  if (a > 2.0 || a < 0.5) {
    const isSocial =
      src === 'og-image' || src === 'twitter-image' || src === 'social-og';
    return isSocial ? -900 : -400;
  }

  // handled by square bonus elsewhere
  if (Math.abs(w - h) / Math.max(w, h) <= 0.1) return 0;
  return -180; // mild penalty for rectangles
}

/**
 * Slightly prefer images on the same host (or subdomain) as the site.
 * @param {string} candidateUrl
 * @param {string} expectedHost
 * @returns {number}
 */
function sameHostDelta(candidateUrl, expectedHost) {
  if (!expectedHost) return 0;
  const ch = normalizeHost(getHostname(candidateUrl));
  const eh = normalizeHost(expectedHost);
  if (!ch || !eh) return 0;
  // If candidate host ends with the expected host (allowing cdn subdomains),
  // boost.
  if (ch === eh || ch.endsWith('.' + eh)) return 140;
  return -90;
}

/**
 * Compute a score for a candidate image.
 * @param {any} c
 * @param {{expectedHost?: string}} [opts]
 * @returns {number}
 */
function candidateScore(c, { expectedHost, brandWords = [] } = {}) {
  // Base scores by source
  const sourceWeight = {
    'manifest-icon': 520,
    'android-chrome': 520,
    'mask-icon': 460,
    'apple-touch-icon': 430,
    icon: 360,
    'img-logo': 340,

    // Lower the base trust of OG/Twitter images to avoid picking banners
    'og-image': 80,
    'twitter-image': 70,
    'social-og': 60,
    'guess-path': 300,
  }[c.source] || 0;

  const fmtWeight = {
    svg: 320,
    png: 200,
    webp: 150,
    ico: 120,
    gif: 20, // animated or low quality often not a logo
    jpg: 40,
    jpeg: 40,
    avif: 150,
  }[c.format || ''] || 0;

  const w = c.width || 0;
  const h = c.height || 0;
  const minSide = Math.min(w, h);
  // Slightly lower cap to avoid over-rewarding very large banners
  const areaWeight = Math.min(minSide, 800);
  const squareBonus = w && h && w === h ? 1000 : 0;
  const nearSquareBonus =
    !squareBonus && w && h && Math.abs(w - h) / Math.max(w, h) <= 0.1 ? 80 : 0;

  const bigDeclBonus =
    (c.declaredSizes || []).some((s) => s.w >= 512 && s.h >= 512) ? 60 : 0;

  // Hard penalty if too small
  const sizeBonus = minSide >= MIN_SIZE ? 200 : -500;

  const urlLower = (c.url || '').toLowerCase();
  const keywordDelta = keywordScoreForUrl(urlLower);
  const aspectDelta = extremeAspectPenalty(w, h, c.source);
  const hostDelta = sameHostDelta(c.url, expectedHost);
  // Logos frequently have transparency; small bonus for alpha on rasters
  const alphaDelta = c.hasAlpha && (c.format === 'png' || c.format === 'webp') ? 60 : 0;

  // Additional penalty for JPEG OG/Twitter images
  const socialJpegPenalty = (c.source === 'og-image' || c.source === 'twitter-image' || c.source === 'social-og') && (c.format === 'jpg' || c.format === 'jpeg') ? -120 : 0;

  // Brand-awareness: check URL, host, and alt/title for brand words
  const lowerAlt = (c.alt || '').toLowerCase();
  const lowerTitle = (c.title || '').toLowerCase();
  const chost = getHostname(c.url || '');
  const brandHitUrl = brandWords.some((wrd) => urlLower.includes(wrd));
  const brandHitHost = brandWords.some((wrd) => (chost || '').includes(wrd));
  const brandHitText = brandWords.some((wrd) => lowerAlt.includes(wrd) || lowerTitle.includes(wrd));
  const brandBoost = (brandHitUrl ? 220 : 0) + (brandHitHost ? 160 : 0) + (brandHitText ? 260 : 0);

  // Penalize social hosts additionally (e.g., facebook, twitter) unless brand-matched
  const isSocialHost = SOCIAL_HOSTS.includes(chost);
  const socialHostPenalty = isSocialHost && !brandHitHost ? -300 : 0;

  // If it's an on-page <img> logo but off-host and no brand hint, penalize heavily
  const offHostNoBrandPenalty =
    c.source === 'img-logo' && !(chost === normalizeHost(expectedHost) || chost.endsWith('.' + normalizeHost(expectedHost))) &&
    !brandHitUrl && !brandHitText
      ? -220
      : 0;

  return (
    sourceWeight +
    fmtWeight +
    areaWeight +
    squareBonus +
    nearSquareBonus +
    bigDeclBonus +
    sizeBonus +
    keywordDelta +
    aspectDelta +
    hostDelta +
    alphaDelta +
    socialJpegPenalty +
    brandBoost +
    socialHostPenalty +
    offHostNoBrandPenalty
  );
}

/**
 * Quick check to reject obvious banner-like non-logos.
 * @param {any} c
 * @returns {boolean}
 */
function isLikelyBanner(c) {
  const w = c.width || 0;
  const h = c.height || 0;
  if (!w || !h) return false;
  const a = w / h;
  const urlLower = (c.url || '').toLowerCase();

  const negHints = ['banner', 'hero', 'cover', 'header', 'social', 'og'];
  const hasNeg = negHints.some((k) => urlLower.includes(k));
  const isSocial =
    c.source === 'og-image' ||
    c.source === 'twitter-image' ||
    c.source === 'social-og';

  // If it's extremely wide/tall and has negative hints or from social, drop.
  if ((a > 3 || a < 1 / 3) && (hasNeg || isSocial)) return true;
  // Be stricter for social-sourced images: near-square only
  if (isSocial && (a > 1.8 || a < 1 / 1.8)) return true;
  return false;
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
    out.push({
      url: abs,
      source: 'manifest-icon',
      declaredSizes: parseSizes(icon.sizes),
      purpose: icon.purpose,
      type: icon.type,
    });
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
      else if (rel.includes('icon')) source = 'icon';
      cands.push({ url: abs, source, declaredSizes: sizes });
    },
  );

  // Manifest
  const manifestHref = $('link[rel="manifest"]').attr('href');
  if (manifestHref) {
    const abs = toAbsolute(manifestHref, baseUrl);
    if (abs) cands.push({ url: abs, source: 'manifest-link' });
  }

  // OG/Twitter images (fallback)
  const og = $('meta[property="og:image"]').attr('content');
  if (og) {
    const abs = toAbsolute(og, baseUrl);
    if (abs) cands.push({ url: abs, source: 'og-image' });
  }

  const tw = $('meta[name="twitter:image"], meta[name="twitter:image:src"]').attr('content');
  if (tw) {
    const abs = toAbsolute(tw, baseUrl);
    if (abs) cands.push({ url: abs, source: 'twitter-image' });
  }

  // Obvious <img> logos
  const logoSel =
    'img[alt*="logo" i], img[class*="logo" i], img[id*="logo" i], img[src*="logo" i]';
  $(logoSel).each((_, el) => {
    const src = $(el).attr('src') || '';
    const srcset = $(el).attr('srcset') || '';
    const alt = ($(el).attr('alt') || '').trim();
    const title = ($(el).attr('title') || '').trim();
    const chosen = chooseSrcFromSrcset(src, srcset);
    const chosenLower = (chosen || '').toLowerCase();
    // Skip obvious social brand marks embedded in the site's footer/header
    if (/facebook|instagram|linkedin|twitter|twimg|x-logo/.test(chosenLower)) {
      return;
    }

    const abs = toAbsolute(chosen, baseUrl);
    if (abs) cands.push({ url: abs, source: 'img-logo', alt, title });
  });

  // JSON-LD sameAs (social)
  const socialLinks = new Set();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const txt = $(el).contents().text();
      const data = JSON.parse(txt);
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        if (item && item.sameAs) {
          const arr = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
          for (const s of arr) if (typeof s === 'string') socialLinks.add(s);
        }
      }
    } catch { /* ignore */ }
  });

  // On-page <a> to social
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href) return;
    const abs = toAbsolute(href, baseUrl);
    if (!abs) return;
    try {
      const u = new URL(abs);
      if (SOCIAL_HOSTS.includes(u.hostname)) socialLinks.add(abs);
    } catch { /* ignore */ }
  });

  for (const s of socialLinks) cands.push({ url: s, source: 'social-link' });

  return cands;
}

function chooseSrcFromSrcset(src, srcset) {
  if (srcset) {
    // Pick the highest density/width item
    const items = srcset
      .split(',')
      .map((x) => x.trim())
      .map((item) => {
        const m = item.match(/(\S+)\s+(\d+(\.\d+)?)(w|x)/);
        if (m) return { url: m[1], score: parseFloat(m[2]) };
        return { url: item.split(/\s+/)[0], score: 1 };
      })
      .sort((a, b) => b.score - a.score);
    if (items[0]) return items[0].url;
  }

  return src;
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
    if (abs) cands.push({ url: abs, source: p.endsWith('.json') || p.endsWith('manifest') ? 'manifest-link' : 'guess-path' });
  }

  return uniq(cands);
}

async function trySocialOgImage(socialUrl) {
  const page = await fetchText(socialUrl);
  if (!page.ok) return null;
  const $ = cheerio.load(page.text);
  const og = $('meta[property="og:image"]').attr('content');
  if (og) {
    const abs = toAbsolute(og, page.url || socialUrl);
    if (abs) return { url: abs, source: 'social-og' };
  }

  return null;
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

  // If it's a social link (page), try to resolve its OG image instead
  if (cand.source === 'social-link') {
    const soc = await trySocialOgImage(cand.url);
    if (soc) {
      const sres = await fetchBuffer(soc.url);
      if (sres.ok) {
        const smeta = await getImageMeta(sres.buffer);
        if (smeta) {
          return {
            ...soc,
            buffer: sres.buffer,
            width: smeta.width || 0,
            height: smeta.height || 0,
            format: smeta.format || '',
            hasAlpha: smeta.hasAlpha || false,
          };
        }
      }
    }

    return null;
  }

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

    // Use the existing logo fetching logic
    const bases = domainToBases(psp.url);
    const allCandidates = [];

    for (const base of bases) {
      const got = await collectCandidatesForBase(base).catch(() => []);
      allCandidates.push(...got);
    }

    // Expand manifest links into icons
    const expanded = (await Promise.all(allCandidates.map((c) => probeCandidate(c))))
      .flat()
      .filter(Boolean);

    // Dedup and keep only URLs that look fetchable
    const unique = uniq(
      expanded.filter((c) => {
        try {
          new URL(c.url);
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (!unique.length) {
      console.log(`❌ ${psp.name}: No icon candidates discovered`);
      return { psp: psp.name, status: 'failed', reason: 'no candidates' };
    }

    // Fetch and measure with a concurrency cap
    const measured = (
      await withLimit(MAX_CONCURRENCY, unique, fetchAndMeasure)
    ).filter(Boolean);

    // Compute brand/host context early for filtering and scoring
    let expectedHost = '';
    try {
      expectedHost = new URL(psp.url).hostname;
    } catch {
      expectedHost = '';
    }

    const brandWords = deriveBrandWords(psp.url, psp.name || '');

    // Enforce minimum size; allow SVG and upscale later if needed
    const nonBanner = measured.filter((m) => !isLikelyBanner(m));
    // Drop obvious third-party marks (social logos, payment badges)
    let nonForeign = nonBanner.filter((m) => !isForeignBrandMarkUrl(m, brandWords));

    // Additional rule: if source is img-logo, require it to look like the site's brand
    nonForeign = nonForeign.filter((m) => {
      if (m.source !== 'img-logo') return true;
      const urlLower = (m.url || '').toLowerCase();
      const altLower = (m.alt || '').toLowerCase();
      const titleLower = (m.title || '').toLowerCase();
      const looksLikeLogo = urlLower.includes('logo') || altLower.includes('logo') || titleLower.includes('logo');
      const hasBrand = brandWords.some((w) => urlLower.includes(w) || altLower.includes(w) || titleLower.includes(w));
      return looksLikeLogo || hasBrand;
    });

    let viable = nonForeign.filter((m) => {
      if (m.format === 'svg') return true; // vector: fine
      const minSide = Math.min(m.width || 0, m.height || 0);
      return minSide >= MIN_SIZE;
    });

    // Fallback: if nothing >=128, allow >=96 as a last resort (will be upscaled)
    if (!viable.length) {
      viable = nonForeign.filter((m) => {
        if (m.format === 'svg') return true;
        const minSide = Math.min(m.width || 0, m.height || 0);
        return minSide >= 96;
      });
    }

    if (!viable.length) {
      // Last-chance fallback: on-host small icons from link/guess-path sources (>=48px)
      const normExpectedHost = normalizeHost(expectedHost);
      const smallIconish = nonForeign.filter((m) => {
        const ch = normalizeHost(getHostname(m.url || ''));
        const onHost = !normExpectedHost || ch === normExpectedHost || ch.endsWith('.' + normExpectedHost);
        const isIconish = m.source === 'icon' || m.source === 'apple-touch-icon' || m.source === 'guess-path' || m.source === 'manifest-icon';
        if (!(onHost && isIconish)) return false;
        if (m.format === 'svg') return true;
        const minSide = Math.min(m.width || 0, m.height || 0);
        return minSide >= 48;
      });
      if (smallIconish.length) {
        viable = smallIconish;
      } else {
        console.log(`❌ ${psp.name}: No viable icons found (>= 128x128 or SVG)`);
        return { psp: psp.name, status: 'failed', reason: 'no viable icons' };
      }
    }

    // Prefer non-social images when available
    const isSocialSource = (s) => s === 'og-image' || s === 'twitter-image' || s === 'social-og';
    const hasNonSocial = viable.some((v) => !isSocialSource(v.source));
    if (hasNonSocial) {
      viable = viable.filter((v) => !isSocialSource(v.source));
    }

    // If both on-host and off-host exist, keep on-host
    const normExpected = normalizeHost(expectedHost);
    const hasOnHost = viable.some((v) => {
      const ch = normalizeHost(getHostname(v.url || ''));
      return ch === normExpected || ch.endsWith('.' + normExpected);
    });
    if (hasOnHost) {
      viable = viable.filter((v) => {
        const ch = normalizeHost(getHostname(v.url || ''));
        return ch === normExpected || ch.endsWith('.' + normExpected);
      });
    }

    // Pick the best by score
    const withScores = viable.map((v) => ({
      ...v,
      _score: candidateScore(v, { expectedHost, brandWords }),
    }));
    withScores.sort((a, b) => b._score - a._score);
    const best = withScores[0];

    // Prepare final 128x128 PNG
    const isSquare = best.width && best.height && best.width === best.height;
    const fit = isSquare ? 'cover' : 'contain';

    let image = sharp(best.buffer, { animated: false });

    // Rasterize SVG at a generous size before downscaling
    if (best.format === 'svg') {
      image = sharp(best.buffer, { density: 512 });
    }

    image = image
      .resize(MIN_SIZE, MIN_SIZE, {
        fit,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      })
      .withMetadata({});

    // Write out
    const tmp = path.join(
      path.dirname(outputPath),
      `.tmp-logo-${crypto.randomBytes(6).toString('hex')}.png`,
    );
    await pipeline(image, createWriteStream(tmp));

    // Atomically move
    const finalBuf = await readFile(tmp);
    await pipeline(sharp(finalBuf), createWriteStream(outputPath));

    // Clean up temp file
    try {
      const fs = await import('node:fs');
      await fs.promises.unlink(tmp);
    } catch {}

    console.log(`✅ ${psp.name}: Updated ${outputPath} (${best.source}, ${best.width}x${best.height})`);
    return {
      psp: psp.name,
      status: 'success',
      output: outputPath,
      source: best.source,
      dimensions: `${best.width}x${best.height}`,
      format: best.format,
    };

  } catch (error) {
    console.log(`❌ ${psp.name}: Error - ${error.message}`);
    return { psp: psp.name, status: 'error', reason: error.message };
  }
}

async function processBulk(pspsJsonPath = './public/psps.json') {
  const assetsDir = path.resolve('./assets/images');

  try {
    // Read PSPs data
    const pspsData = JSON.parse(await readFile(path.resolve(pspsJsonPath), 'utf8'));
    const psps = pspsData.psps || [];

    console.log(`🚀 Processing ${psps.length} PSPs from ${pspsJsonPath}`);
    console.log(`📁 Output directory: ${assetsDir}\n`);

    // Process PSPs with limited concurrency to be respectful to websites
    const results = await withLimit(2, psps, async(psp) => {
      const result = await processLogoForPSP(psp, assetsDir);
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
      console.log('\n❌ Failed PSPs:');
      failed.forEach(r => console.log(`  - ${r.psp}: ${r.reason}`));
    }

    if (errors.length > 0) {
      console.log('\n💥 Error PSPs:');
      errors.forEach(r => console.log(`  - ${r.psp}: ${r.reason}`));
    }

    return results;

  } catch (error) {
    console.error(`Failed to process bulk: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const [, , firstArg, secondArg] = process.argv;

  // Check for bulk mode
  if (firstArg === '--bulk') {
    const pspsJsonPath = secondArg || './public/psps.json';
    await processBulk(pspsJsonPath);
    return;
  }

  // Original single-site mode
  const domainArg = firstArg;
  const outArg = secondArg;

  if (!domainArg) {
    console.error('Usage: node get-site-logo.mjs <domain-or-url> [output.png]');
    console.error('       node get-site-logo.mjs --bulk [psps.json]');
    process.exit(1);
  }

  const outPath = pickOutputPath(domainArg, outArg);

  // Gather candidates from HTTPS first, then HTTP as fallback
  const bases = domainToBases(domainArg);
  const allCandidates = [];
  for (const base of bases) {
    const got = await collectCandidatesForBase(base).catch(() => []);
    allCandidates.push(...got);
  }

  // Expand manifest links into icons
  const expanded = (await Promise.all(allCandidates.map((c) => probeCandidate(c))))
    .flat()
    .filter(Boolean);

  // Dedup and keep only URLs that look fetchable
  const unique = uniq(
    expanded.filter((c) => {
      try {
        new URL(c.url);
        return true;
      } catch {
        return false;
      }
    }),
  );

  if (!unique.length) {
    console.error('No icon candidates discovered.');
    process.exit(2);
  }

  // Fetch and measure with a concurrency cap
  const measured = (
    await withLimit(MAX_CONCURRENCY, unique, fetchAndMeasure)
  ).filter(Boolean);

  // Drop likely banners and obvious foreign brand marks; compute context
  const nonBanner = measured.filter((m) => !isLikelyBanner(m));

  let expectedHost = '';
  try {
    const inputHost = domainArg.startsWith('http') ? domainArg : `https://${domainArg}`;
    expectedHost = new URL(inputHost).hostname;
  } catch {
    expectedHost = '';
  }

  const brandWords = deriveBrandWords(domainArg, '');
  let nonForeign = nonBanner.filter((m) => !isForeignBrandMarkUrl(m, brandWords));

  nonForeign = nonForeign.filter((m) => {
    if (m.source !== 'img-logo') return true;
    const urlLower = (m.url || '').toLowerCase();
    const altLower = (m.alt || '').toLowerCase();
    const titleLower = (m.title || '').toLowerCase();
    const looksLikeLogo = urlLower.includes('logo') || altLower.includes('logo') || titleLower.includes('logo');
    const hasBrand = brandWords.some((w) => urlLower.includes(w) || altLower.includes(w) || titleLower.includes(w));
    return looksLikeLogo || hasBrand;
  });

  let viable = nonForeign.filter((m) => {
    if (m.format === 'svg') return true; // vector: fine
    const minSide = Math.min(m.width || 0, m.height || 0);
    return minSide >= MIN_SIZE;
  });

  // Fallback: if nothing >=128, allow >=96 as a last resort (will be upscaled)
  if (!viable.length) {
    viable = nonForeign.filter((m) => {
      if (m.format === 'svg') return true;
      const minSide = Math.min(m.width || 0, m.height || 0);
      return minSide >= 96;
    });
  }

  if (!viable.length) {
    // Last-chance fallback: on-host small icons from link/guess-path sources (>=48px)
    const normExpectedHost = normalizeHost(expectedHost);
    const smallIconish = nonForeign.filter((m) => {
      const ch = normalizeHost(getHostname(m.url || ''));
      const onHost = !normExpectedHost || ch === normExpectedHost || ch.endsWith('.' + normExpectedHost);
      const isIconish = m.source === 'icon' || m.source === 'apple-touch-icon' || m.source === 'guess-path' || m.source === 'manifest-icon';
      if (!(onHost && isIconish)) return false;
      if (m.format === 'svg') return true;
      const minSide = Math.min(m.width || 0, m.height || 0);
      return minSide >= 48;
    });
    if (smallIconish.length) {
      viable = smallIconish;
    } else {
      console.error('No viable icons found (>= 128x128 or SVG).');
      process.exit(3);
    }
  }

  // Prefer non-social images when available
  const isSocialSource = (s) => s === 'og-image' || s === 'twitter-image' || s === 'social-og';
  const hasNonSocial = viable.some((v) => !isSocialSource(v.source));
  if (hasNonSocial) {
    viable = viable.filter((v) => !isSocialSource(v.source));
  }

  // If both on-host and off-host exist, keep on-host
  const normExpected = normalizeHost(expectedHost);
  const hasOnHost = viable.some((v) => {
    const ch = normalizeHost(getHostname(v.url || ''));
    return ch === normExpected || ch.endsWith('.' + normExpected);
  });
  if (hasOnHost) {
    viable = viable.filter((v) => {
      const ch = normalizeHost(getHostname(v.url || ''));
      return ch === normExpected || ch.endsWith('.' + normExpected);
    });
  }

  // Pick the best by score
  const withScores = viable.map((v) => ({
    ...v,
    _score: candidateScore(v, { expectedHost, brandWords }),
  }));
  withScores.sort((a, b) => b._score - a._score);
  const best = withScores[0];

  // Prepare final 128x128 PNG (lossless). If not square, use 'contain' with transparent padding.
  const isSquare = best.width && best.height && best.width === best.height;
  const fit = isSquare ? 'cover' : 'contain';

  let image = sharp(best.buffer, { animated: false });

  // Rasterize SVG at a generous size before downscaling, to retain detail
  if (best.format === 'svg') {
    image = sharp(best.buffer, { density: 512 }); // high density render
  }

  // Some ICOs might be small; sharp can upscale, but we prefer not to if avoidable.
  image = image
    .resize(MIN_SIZE, MIN_SIZE, {
      fit,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .png({
      compressionLevel: 9, // max zlib compression (lossless)
      adaptiveFiltering: true,
    })
    .withMetadata({});

  // Write out
  const tmp = path.join(
    path.dirname(outPath),
    `.tmp-logo-${crypto.randomBytes(6).toString('hex')}.png`,
  );
  await pipeline(image, createWriteStream(tmp));

  // Atomically move
  const finalBuf = await readFile(tmp);
  await pipeline(sharp(finalBuf), createWriteStream(outPath));

  // Report
  console.log(
    JSON.stringify(
      {
        output: outPath,
        chosen: {
          url: best.url,
          source: best.source,
          width: best.width || null,
          height: best.height || null,
          format: best.format,
          score: best._score,
        },
        considered: withScores
          .slice(0, 8)
          .map((c) => ({
            url: c.url,
            source: c.source,
            w: c.width || null,
            h: c.height || null,
            fmt: c.format,
            score: c._score,
          })),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(10);
});
