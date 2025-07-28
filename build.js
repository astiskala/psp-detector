const esbuild = require('esbuild');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { execFile } = require('child_process');
const zopflipng = require('zopflipng-bin');

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

const zopflipngPath = zopflipng.default || zopflipng;

// Utility to compress PNG with zopflipng
async function compressPng (input, output) {
  return new Promise((resolve, reject) => {
    execFile(zopflipngPath, ['-y', '--lossless', input, output], err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

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
        .png()
        .toFile(outPath);
      console.log(`Resized ${file} to ${size}x${size} as ${base}_${size}.png`);
      await compressPng(outPath, outPath);
      console.log(`Compressed ${base}_${size}.png`);
    }
  }
}

// Build each entry point separately
async function buildFiles () {
  try {
    // Generate version: 2.YYYYMMDD.HHMM
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const version = `2.${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
      now.getDate()
    )}.${pad(now.getHours())}${pad(now.getMinutes())}`;

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
