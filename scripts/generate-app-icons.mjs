import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'assets', 'icons');
const resourceDir = path.join(root, 'android', 'app', 'src', 'main', 'res');
const background = '#176B49';
const size = 1024;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

await fs.mkdir(iconDir, { recursive: true });
const portrait = await sharp(path.join(root, 'assets', 'sprites', 'characters', 'chip_idle.png'))
    .extract({ left: 8, top: 0, width: 36, height: 34 })
    .trim()
    .png()
    .toBuffer();
const logoPortrait = await sharp(portrait)
    .resize(496, 496, { fit: 'contain', background: transparent, kernel: 'nearest' })
    .png()
    .toBuffer();

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
        <linearGradient id="fairway" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#23845B"/><stop offset="1" stop-color="#0A382A"/></linearGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FFF1A8"/><stop offset="1" stop-color="#D8A93E"/></linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="5"/><feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1024" height="1024" fill="url(#fairway)"/>
    <rect x="34" y="34" width="956" height="956" rx="68" fill="none" stroke="url(#gold)" stroke-width="12"/>
    <rect x="54" y="54" width="916" height="916" rx="52" fill="none" stroke="#EAF1D4" stroke-opacity=".42" stroke-width="3"/>
    <path d="M180 218H844" stroke="url(#gold)" stroke-width="5" stroke-linecap="round" opacity=".8"/>
    <circle cx="152" cy="218" r="8" fill="#F7DE87"/><circle cx="872" cy="218" r="8" fill="#F7DE87"/>
    <text x="512" y="178" text-anchor="middle" fill="#FFF9E8" stroke="#123A2B" stroke-width="5" paint-order="stroke" font-family="Arial Black, Impact, sans-serif" font-size="112" font-weight="900" letter-spacing="12" filter="url(#shadow)">CHIP</text>
    <image x="264" y="254" width="496" height="496" preserveAspectRatio="none" href="data:image/png;base64,${logoPortrait.toString('base64')}"/>
    <path d="M252 782H772" stroke="#EAF1D4" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
    <circle cx="232" cy="782" r="7" fill="url(#gold)"/><circle cx="792" cy="782" r="7" fill="url(#gold)"/>
    <text x="512" y="888" text-anchor="middle" fill="url(#gold)" stroke="#153A2B" stroke-width="6" paint-order="stroke" font-family="Arial Black, Impact, sans-serif" font-size="92" font-weight="900" letter-spacing="7" filter="url(#shadow)">SAVAGE</text>
    <path d="M492 928H532" stroke="#EAF1D4" stroke-width="4" stroke-linecap="round" opacity=".75"/>
    <circle cx="512" cy="928" r="9" fill="#F8F5E9" stroke="#CBA547" stroke-width="3"/>
</svg>`;
const logoSvgPath = path.join(iconDir, 'chip-savage-logo.svg');
await fs.writeFile(logoSvgPath, logoSvg, 'utf8');
const logo = await sharp(Buffer.from(logoSvg)).png().toBuffer();

async function foreground(subjectSize) {
    const subject = await sharp(portrait)
        .resize(subjectSize, subjectSize, { fit: 'contain', background: transparent, kernel: 'nearest' })
        .png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
        .composite([{ input: subject, left: (size - subjectSize) / 2, top: (size - subjectSize) / 2 }])
        .png().toBuffer();
}

const adaptiveForeground = await foreground(440);
const maskableForeground = await foreground(560);
const { data, info } = await sharp(adaptiveForeground).raw().toBuffer({ resolveWithObject: true });
let opaquePixels = 0;
for (let row = 0; row < info.height; row++) {
    for (let column = 0; column < info.width; column++) {
        if (data[(row * info.width + column) * 4 + 3] === 0) continue;
        opaquePixels++;
        assert.ok(Math.hypot(column + 0.5 - size / 2, row + 0.5 - size / 2) <= size * 33 / 108,
            'Chip must remain inside the adaptive icon safe circle');
    }
}
assert.ok(opaquePixels > 10000, 'Foreground must contain visible character artwork');

const maskable = await sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: maskableForeground }]).png().toBuffer();
await sharp(maskable).toFile(path.join(iconDir, 'chip-maskable-1024.png'));
await sharp(logo).resize(512, 512, { kernel: 'nearest' }).flatten({ background }).removeAlpha()
    .png().toFile(path.join(iconDir, 'chip-play-store-512.png'));
await sharp(maskable).resize(512, 512, { kernel: 'nearest' }).png().toFile(path.join(iconDir, 'chip-maskable-512.png'));
await sharp(maskable).resize(192, 192).png().toFile(path.join(iconDir, 'chip-maskable-192.png'));

for (const [density, launcherSize, foregroundSize] of [
    ['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216],
    ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]
]) {
    const directory = path.join(resourceDir, `mipmap-${density}`);
    await fs.mkdir(directory, { recursive: true });
    await sharp(adaptiveForeground).resize(foregroundSize, foregroundSize)
        .png().toFile(path.join(directory, 'ic_launcher_foreground.png'));
    await sharp(maskable).resize(launcherSize, launcherSize)
        .png().toFile(path.join(directory, 'ic_launcher.png'));
    const circle = Buffer.from(`<svg width="${launcherSize}" height="${launcherSize}"><circle cx="${launcherSize / 2}" cy="${launcherSize / 2}" r="${launcherSize / 2}" fill="white"/></svg>`);
    await sharp(maskable).resize(launcherSize, launcherSize)
        .composite([{ input: circle, blend: 'dest-in' }])
        .png().toFile(path.join(directory, 'ic_launcher_round.png'));
}

console.log('Generated Chip launcher and store icons; adaptive foreground safe-circle check passed.');