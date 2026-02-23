import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

/** Read and parse a JSON file synchronously. */
function readJsonSync(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Write an object as pretty-printed JSON synchronously. */
function writeJsonSync(filePath, obj) {
  writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainEntryPoints = {
  content: './src/content.ts',
  background: './src/background.ts',
  popup: './src/popup.ts',
  options: './src/options.ts',
  onboarding: './src/onboarding.ts',
};

const sharedConfig = {
  bundle: true,
  minify: !process.env.DEBUG,
  sourcemap: process.env.DEBUG ? !process.env.NO_SOURCEMAP : false,
  target: 'esnext',
  format: 'esm',
  platform: 'browser',
  supported: {
    'top-level-await': true,
    'import-meta': true,
  },
  define: {
    'process.env.NODE_ENV': process.env.DEBUG
      ? '"development"'
      : '"production"',
  },

  // TypeScript-specific optimizations
  tsconfig: './tsconfig.json',
  keepNames: true,
  metafile: !!process.env.DEBUG,
  logLevel: process.env.DEBUG ? 'info' : 'warning',
};

/**
 * Generate PSP images in different sizes
 * @returns {Promise<void>}
 */
async function generatePspImages() {
  const srcDir = path.join(__dirname, 'assets', 'images');
  const distDir = path.join(__dirname, 'dist', 'images');
  await fs.mkdir(distDir, { recursive: true });

  const files = await fs.readdir(srcDir);
  const pspPngs = files.filter(
    (f) => f.endsWith('.png') && !/_48\.png$|_128\.png$/.test(f),
  );

  console.log(`Found ${pspPngs.length} PSP images in source.`);

  // cleanup old
  for (const f of await fs.readdir(distDir)) {
    if (/_48\.png$|_128\.png$/.test(f)) {
      await fs.rm(path.join(distDir, f), { force: true });
    }
  }

  // regenerate
  for (const file of pspPngs) {
    const base = file.replace(/\.png$/, '');
    const srcPath = path.join(srcDir, file);
    for (const size of [128, 48]) {
      const outPath = path.join(distDir, `${base}_${size}.png`);
      await sharp(srcPath)
        .resize(size, size, { fit: 'contain' })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: true,
          quality: 100,
          effort: 10,
        })
        .toFile(outPath);

      console.log(`Resized ${file} → ${base}_${size}.png`);
    }
  }
}

/**
 * Build extension files
 * @returns {Promise<void>}
 */
async function buildFiles() {
  try {
    // 1) compute version
    const now = new Date();
    const year = now.getFullYear();
    const mmdd = (now.getMonth() + 1) * 100 + now.getDate();
    const hhmm = now.getHours() * 100 + now.getMinutes();
    const version = `3.${year}.${mmdd}.${hhmm}`;

    // 2) bump package.json in-place
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = readJsonSync(pkgPath);
    pkg.version = version;
    writeJsonSync(pkgPath, pkg);

    // 3) prepare dist/
    const distDir = path.join(__dirname, 'dist');
    await fs.rm(distDir, { recursive: true, force: true });
    await fs.mkdir(distDir, { recursive: true });

    // 4) copy all public/ → dist/
    const publicDir = path.join(__dirname, 'public');
    try {
      await fs.access(publicDir);
      await fs.cp(publicDir, distDir, { recursive: true });
      console.log('Copied public/ → dist/');
    } catch {
      // public/ does not exist — skip copy
    }

    // 5) inject and write manifest.json
    const manifestSrc = path.join(__dirname, 'assets', 'manifest.json');
    const manifestDst = path.join(distDir, 'manifest.json');
    const manifest = readJsonSync(manifestSrc);
    manifest.version = version;

    // adjust service_worker and content_scripts paths if needed:
    if (manifest.background?.service_worker) {
      manifest.background.service_worker =
        manifest.background.service_worker.replace(/^dist\//, '');
    }

    if (Array.isArray(manifest.content_scripts)) {
      manifest.content_scripts.forEach((cs) => {
        if (cs.js) {
          cs.js = cs.js.map((js) => js.replace(/^dist\//, ''));
        }
      });
    }

    writeJsonSync(manifestDst, manifest);
    console.log(`Wrote dist/manifest.json @ version ${version}`);

    // 6) bundle JS
    await Promise.all(
      Object.entries(mainEntryPoints).map(([name, entry]) =>
        esbuild.build({
          ...sharedConfig,
          entryPoints: [entry],
          outfile: `dist/${name}.js`,
        }),
      ),
    );

    // 7) regenerate PSP images
    await generatePspImages();

    console.log('🛠 Build complete');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

await buildFiles();
