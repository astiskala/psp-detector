const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

const mainEntryPoints = {
  content: './app/js/content.ts',
  background: './app/js/background.ts',
  popup: './app/js/popup.ts'
};

const sharedConfig = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: 'es2020',
  format: 'esm',
  platform: 'browser',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
};

// Generate resized and compressed PNGs for all PSP images
async function generatePspImages () {
  const srcDir = path.join(__dirname, 'app', 'images');
  const distDir = path.join(__dirname, 'app', 'dist', 'images');
  await fs.ensureDir(distDir);
  const files = await fs.readdir(srcDir);
  // Only .png files that do not have _16/_48/_128 suffix
  const pspPngs = files.filter(
    f => f.endsWith('.png') && !/_16\.png$|_48\.png$|_128\.png$/.test(f)
  );
  console.log(`Found ${pspPngs.length} PSP images in source.`);
  // Remove any 16/48/128px PNGs from dist
  let removed = 0;
  for (const f of await fs.readdir(distDir)) {
    if (/_16\.png$|_48\.png$|_128\.png$/.test(f)) {
      await fs.remove(path.join(distDir, f));
      removed++;
    }
  }
  if (removed)
    console.log(`Removed ${removed} old 16/48/128px images from dist.`);
  for (const file of pspPngs) {
    const base = file.replace(/\.png$/, '');
    const srcPath = path.join(srcDir, file);
    // Always resize to 128px, 48px, 16px (do not copy original as-is)
    for (const size of [128, 48, 16]) {
      const outPath = path.join(distDir, `${base}_${size}.png`);
      await sharp(srcPath)
        .resize(size, size, { fit: 'contain' })
        .png({
          compressionLevel: 9, // Maximum compression
          adaptiveFiltering: true, // Better compression
          palette: true, // Use palette if beneficial
          quality: 100, // Lossless quality
          effort: 10 // Maximum effort
        })
        .toFile(outPath);
      console.log(
        `Resized and compressed ${file} to ${size}x${size} as ${base}_${size}.png`
      );
    }
  }
}

// Build each entry point separately
async function buildFiles () {
  try {
    // ─── VERSION GENERATION ───────────────────────────────────────────────────────
    // Format: 2.YYYY.MMDD.HHMM (four integers)
    const now = new Date();
    const year = now.getFullYear();             // e.g. 2025
    const month = now.getMonth() + 1;           // 1–12
    const day = now.getDate();                  // 1–31
    const hour = now.getHours();                // 0–23
    const minute = now.getMinutes();            // 0–59
    const mmdd = month * 100 + day;             // e.g. July 28 → 7*100 + 28 = 728
    const hhmm = hour * 100 + minute;           // e.g. 14:42 → 14*100 + 42 = 1442
    const version = `2.${year}.${mmdd}.${hhmm}`;
    // ─────────────────────────────────────────────────────────────────────────────

    // Update package.json version
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = fs.readJsonSync(pkgPath);
    pkg.version = version;
    fs.writeJsonSync(pkgPath, pkg, { spaces: 2 });

    // Update manifest.json version and sync fields
    const manifestPath = path.join(__dirname, 'app', 'manifest.json');
    const manifest = fs.readJsonSync(manifestPath);
    manifest.version = version;
    manifest.name = 'PSP Detector'; // Always use user-friendly name
    manifest.description = pkg.description;
    if (manifest.background && manifest.background.service_worker) {
      manifest.background.service_worker =
        manifest.background.service_worker.replace(/^dist\//, '');
    }
    if (manifest.content_scripts) {
      manifest.content_scripts.forEach(cs => {
        if (cs.js) {
          cs.js = cs.js.map(jsPath => jsPath.replace(/^dist\//, ''));
        }
      });
    }
    fs.writeJsonSync(manifestPath, manifest, { spaces: 2 });
    console.log(`manifest.json and package.json version set to ${version}`);

    const buildPromises = Object.entries(mainEntryPoints).map(
      ([name, entry]) => {
        return esbuild.build({
          ...sharedConfig,
          entryPoints: [entry],
          outfile: `./app/dist/${name}.js`
        });
      }
    );

    await Promise.all(buildPromises);
    // Copy static assets after build
    const assets = [
      'manifest.json',
      'popup.html',
      'psp-config.json',
      'exempt-domains.json'
    ];
    for (const file of assets) {
      await fs.copy(
        path.join(__dirname, 'app', file),
        path.join(__dirname, 'app', 'dist', file)
      );
    }
    // Copy images directory (only 128px in src, generate all sizes in dist)
    await fs.ensureDir(path.join(__dirname, 'app', 'dist', 'images'));
    await generatePspImages();
    console.log('Build complete and assets copied');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// Watch mode
async function watchFiles () {
  try {
    const contexts = await Promise.all(
      Object.entries(mainEntryPoints).map(([name, entry]) => {
        return esbuild.context({
          ...sharedConfig,
          entryPoints: [entry],
          outfile: `./app/dist/${name}.js`
        });
      })
    );

    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes...');
  } catch (error) {
    console.error('Watch setup failed:', error);
    process.exit(1);
  }
}

if (process.argv.includes('--watch')) {
  watchFiles();
} else {
  buildFiles();
}
