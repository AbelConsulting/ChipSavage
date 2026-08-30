import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'assets', 'storefront');
const backgroundPath = path.join(rootDir, 'assets', 'sprites', 'backgrounds', 'bg_2.png');
const chipSheetPath = path.join(rootDir, 'assets', 'sprites', 'characters', 'chip_kick.png');
const bossSheetPath = path.join(rootDir, 'assets', 'sprites', 'enemies', 'boss_attack1.png');

const exports = [
  { file: 'feature-graphic-1024x500.png', width: 1024, height: 500, layout: 'wide' },
  { file: 'store-poster-1080x1350.png', width: 1080, height: 1350, layout: 'portrait' },
  { file: 'social-preview-1200x630.png', width: 1200, height: 630, layout: 'wide' }
];

function svgData(svg) {
  return Buffer.from(svg);
}

async function extractFrame(filePath, frameWidth, frameHeight, frameIndex) {
  return sharp(filePath)
    .extract({ left: frameWidth * frameIndex, top: 0, width: frameWidth, height: frameHeight })
    .png()
    .toBuffer();
}

function titleOverlay(width, height, layout) {
  const portrait = layout === 'portrait';
  const titleX = portrait ? width / 2 : width * 0.075;
  const anchor = portrait ? 'middle' : 'start';
  const titleY = portrait ? height * 0.28 : height * 0.46;
  const chipSize = portrait ? width * 0.158 : height * 0.25;
  const savageSize = portrait ? width * 0.198 : height * 0.315;
  const tourSize = portrait ? width * 0.039 : height * 0.056;
  const subtitleY = titleY + savageSize * 0.77;
  const ruleWidth = portrait ? width * 0.64 : width * 0.38;
  const ruleX = portrait ? width * 0.18 : width * 0.075;

  return svgData(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#160c16" flood-opacity="0.95"/>
        </filter>
      </defs>
      <g filter="url(#shadow)" font-family="Impact, Haettenschweiler, sans-serif" text-anchor="${anchor}">
        <text x="${titleX}" y="${titleY - savageSize * 0.6}" font-size="${chipSize}" fill="#f9e7ad" stroke="#251424" stroke-width="${Math.max(3, width * 0.005)}">CHIP</text>
        <text x="${titleX}" y="${titleY}" font-size="${savageSize}" fill="#f5b544" stroke="#251424" stroke-width="${Math.max(4, width * 0.006)}">SAVAGE</text>
        <text x="${titleX}" y="${subtitleY}" font-family="Arial, sans-serif" font-size="${tourSize}" font-weight="900" letter-spacing="${tourSize * 0.12}" fill="#ffffff">A GOLF-BRAWLING METROIDVANIA</text>
      </g>
      <rect x="${ruleX}" y="${subtitleY + tourSize * 0.42}" width="${ruleWidth}" height="${Math.max(4, height * 0.009)}" fill="#78bd43"/>
    </svg>`);
}

function atmosphereOverlay(width, height, layout) {
  const portrait = layout === 'portrait';
  const vignetteEnd = portrait ? '78%' : '62%';
  const sunX = portrait ? width * 0.78 : width * 0.82;
  const sunY = portrait ? height * 0.26 : height * 0.22;
  const sunRadius = Math.min(width, height) * 0.16;

  return svgData(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#160c1f" stop-opacity="0.88"/>
          <stop offset="${vignetteEnd}" stop-color="#160c1f" stop-opacity="0.08"/>
          <stop offset="1" stop-color="#160c1f" stop-opacity="0.34"/>
        </linearGradient>
        <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.62" stop-color="#140b17" stop-opacity="0"/>
          <stop offset="1" stop-color="#140b17" stop-opacity="0.78"/>
        </linearGradient>
        <radialGradient id="sun">
          <stop offset="0" stop-color="#fff3a6" stop-opacity="0.68"/>
          <stop offset="1" stop-color="#f5b544" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect width="${width}" height="${height}" fill="url(#floor)"/>
      <circle cx="${sunX}" cy="${sunY}" r="${sunRadius}" fill="url(#sun)"/>
      <path d="M ${width * 0.44} ${height * 0.81} Q ${width * 0.66} ${height * 0.5} ${width * 0.91} ${height * 0.28}" fill="none" stroke="#f9e7ad" stroke-width="${Math.max(3, height * 0.008)}" stroke-linecap="round" stroke-dasharray="2 ${height * 0.035}" opacity="0.78"/>
      <circle cx="${width * 0.91}" cy="${height * 0.28}" r="${Math.max(7, height * 0.018)}" fill="#ffffff" stroke="#d8d8d8" stroke-width="2"/>
    </svg>`);
}

function frameSvg(image, width, height, shadowSize) {
  const encodedImage = image.toString('base64');
  return svgData(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="sprite-shadow" x="-30%" y="-30%" width="170%" height="180%">
          <feDropShadow dx="0" dy="${shadowSize * 0.7}" stdDeviation="${shadowSize}" flood-color="#100812" flood-opacity="0.9"/>
        </filter>
      </defs>
      <image width="${width}" height="${height}" href="data:image/png;base64,${encodedImage}" filter="url(#sprite-shadow)"/>
    </svg>`);
}

async function renderArtwork(spec, chipFrame, bossFrame) {
  const { width, height, layout, file } = spec;
  const portrait = layout === 'portrait';
  const chipHeight = Math.round(height * (portrait ? 0.46 : 0.62));
  const chipWidth = chipHeight;
  const bossHeight = Math.round(height * (portrait ? 0.55 : 0.78));
  const bossWidth = bossHeight;
  const chipLeft = Math.round(portrait ? width * 0.06 : width * 0.48);
  const chipTop = Math.round(portrait ? height * 0.48 : height * 0.32);
  const bossLeft = Math.round(portrait ? width * 0.48 : width * 0.72);
  const bossTop = Math.round(portrait ? height * 0.40 : height * 0.18);

  const resizedChip = await sharp(chipFrame)
    .resize(chipWidth, chipHeight, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();
  const resizedBoss = await sharp(bossFrame)
    .resize(bossWidth, bossHeight, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();

  const background = await sharp(backgroundPath)
    .resize(width, height, { fit: 'cover', position: portrait ? 'center' : 'attention' })
    .modulate({ saturation: 1.08, brightness: 0.88 })
    .blur(0.35)
    .png()
    .toBuffer();

  await sharp(background)
    .composite([
      { input: atmosphereOverlay(width, height, layout), left: 0, top: 0 },
      { input: frameSvg(resizedBoss, bossWidth, bossHeight, Math.max(5, height * 0.012)), left: bossLeft, top: bossTop },
      { input: frameSvg(resizedChip, chipWidth, chipHeight, Math.max(5, height * 0.012)), left: chipLeft, top: chipTop },
      { input: titleOverlay(width, height, layout), left: 0, top: 0 }
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(outputDir, file));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const [chipFrame, bossFrame] = await Promise.all([
    extractFrame(chipSheetPath, 64, 64, 2),
    extractFrame(bossSheetPath, 128, 128, 2)
  ]);

  await Promise.all(exports.map((spec) => renderArtwork(spec, chipFrame, bossFrame)));
  console.log(`Generated ${exports.length} storefront images in ${path.relative(rootDir, outputDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});