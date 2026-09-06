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
await sharp(maskable).resize(512, 512, { kernel: 'nearest' }).flatten({ background }).removeAlpha()
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