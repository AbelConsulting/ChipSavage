const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const musicDir = path.join(root, 'assets', 'audio', 'music');
const levelData = fs.readFileSync(path.join(root, 'js', 'levelData.js'), 'utf8');
const referencedTracks = new Set();
for (const match of levelData.matchAll(/music\s*:\s*\[([^\]]*)\]/g)) {
    for (const track of match[1].matchAll(/['"]([^'"]+)['"]/g)) referencedTracks.add(track[1]);
}
for (const track of ['menu_theme', 'boss_battle', 'ambient_forest', 'ambient_city', 'ambient_cave_deep']) {
    referencedTracks.add(track);
}

function readWavInfo(file) {
    const data = fs.readFileSync(file);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    assert.equal(data.readUInt16LE(22), 1, 'expected mono output');
    assert.equal(data.readUInt32LE(24), 22050, 'expected 22.05 kHz output');
    assert.equal(data.readUInt16LE(34), 16, 'expected 16-bit PCM');
    const dataChunk = data.indexOf('data', 12, 'ascii');
    assert.ok(dataChunk >= 0, 'WAV data chunk must exist');
    const dataStart = dataChunk + 8;
    const dataLength = data.readUInt32LE(dataChunk + 4);
    let peak = 0;
    for (let offset = dataStart; offset < dataStart + dataLength; offset += 2) {
        peak = Math.max(peak, Math.abs(data.readInt16LE(offset)));
    }
    const samples = dataLength / 2;
    const first = data.readInt16LE(dataStart);
    const last = data.readInt16LE(dataStart + dataLength - 2);
    return { duration: samples / 22050, peak, boundaryJump: Math.abs(first - last) };
}

test('all configured music and ambience have loop-ready WAV and OGG assets', () => {
    assert.ok(referencedTracks.size >= 12, 'expected campaign, menu, boss, and ambience tracks');
    for (const track of referencedTracks) {
        const wav = path.join(musicDir, `${track}.wav`);
        const ogg = path.join(musicDir, `${track}.ogg`);
        assert.ok(fs.existsSync(wav), `missing ${track}.wav`);
        assert.ok(fs.existsSync(ogg), `missing ${track}.ogg`);
        assert.equal(fs.readFileSync(ogg).toString('ascii', 0, 4), 'OggS', `${track}.ogg must be Vorbis container data`);
        const info = readWavInfo(wav);
        assert.ok(info.duration >= 19.8, `${track}.wav is unexpectedly short (${info.duration}s)`);
        assert.ok(info.peak > 1000, `${track}.wav appears silent`);
        assert.ok(info.boundaryJump < 5000, `${track}.wav loop boundary may click (${info.boundaryJump})`);
    }
});
