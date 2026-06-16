import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Tiny sync helper used while preparing build metadata files. */
function readJsonSync(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Writes JSON with stable formatting so generated metadata stays diffable. */
function writeJsonSync(filePath, object) {
  writeFileSync(filePath, `${JSON.stringify(object, null, 2)}\n`);
}

const __filename = import.meta.filename;
const __dirname = import.meta.dirname;

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
Rebuilds the distributable PSP logo set from the source 128px PNG assets.
*/
async function generatePspImages() {
  const sourceDirectory = path.join(__dirname, 'assets', 'images');
  const distributionDirectory = path.join(__dirname, 'dist', 'images');
  await fs.mkdir(distributionDirectory, { recursive: true });

  const files = await fs.readdir(sourceDirectory);
  const pspPngs = files.filter(
    (f) => f.endsWith('.png') && !/_48\.png$|_128\.png$/.test(f),
  );

  console.log(`Found ${pspPngs.length} PSP images in source.`);

  // cleanup old
  for (const f of await fs.readdir(distributionDirectory)) {
    if (/_48\.png$|_128\.png$/.test(f)) {
      await fs.rm(path.join(distributionDirectory, f), { force: true });
    }
  }

  // regenerate
  for (const file of pspPngs) {
    const base = file.replace(/\.png$/, '');
    const sourcePath = path.join(sourceDirectory, file);
    for (const size of [128, 48]) {
      const outPath = path.join(distributionDirectory, `${base}_${size}.png`);
      await sharp(sourcePath)
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
Produces a fresh `dist/` bundle, updates the generated version number, and
regenerates extension assets.
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
    const packagePath = path.join(__dirname, 'package.json');
    const package_ = readJsonSync(packagePath);
    package_.version = version;
    writeJsonSync(packagePath, package_);

    // 3) prepare dist/
    const distributionDirectory = path.join(__dirname, 'dist');
    await fs.rm(distributionDirectory, { recursive: true, force: true });
    await fs.mkdir(distributionDirectory, { recursive: true });

    // 4) copy all public/ → dist/
    const publicDirectory = path.join(__dirname, 'public');
    try {
      await fs.access(publicDirectory);
      await fs.cp(publicDirectory, distributionDirectory, { recursive: true });
      console.log('Copied public/ → dist/');
    } catch {
      // public/ does not exist — skip copy
    }

    // 5) inject and write manifest.json
    const manifestSource = path.join(__dirname, 'assets', 'manifest.json');
    const manifestDestination = path.join(
      distributionDirectory,
      'manifest.json',
    );
    const manifest = readJsonSync(manifestSource);
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

    writeJsonSync(manifestDestination, manifest);
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
  } catch (error) {
    console.error('Build failed:', error);
    throw error;
  }
}

await buildFiles();
