const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const musicDir = path.join(root, 'assets', 'audio', 'music');
const levelData = fs.readFileSync(path.join(root, 'js', 'levelData.js'), 'utf8');
const referencedTracks = new Set();
for (const match of levelData.matchAll(/music\s*:\s*\[([^\]]*)\]/g)) {
    for (const track of match[1].matchAll(/['"]([^'"]+)['"]/g)) referencedTracks.add(track[1]);
}
for (const track of ['menu_theme', 'boss_battle']) {
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

test('all configured music has loop-ready WAV and OGG assets', () => {
    assert.ok(referencedTracks.size >= 9, 'expected campaign, menu, and boss tracks');
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

test('campaign and survival play music without starting ambient audio', async () => {
    const calls = [];
    const audioManager = {
        musicElements: {},
        async loadMusic(name, file) {
            calls.push(['loadMusic', name, file]);
            this.musicElements[name] = {};
        },
        playMusic(name, loop) { calls.push(['playMusic', name, loop]); },
        loadAmbient() { assert.fail('environmental ambience should not be loaded'); },
        playAmbient() { assert.fail('environmental ambience should not be played'); }
    };
    const context = vm.createContext({
        console,
        LEVEL_CONFIGS: [{ music: ['forest_theme'] }],
        SURVIVAL_ARENA_CONFIG: { music: ['city_theme'] }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8') +
        '\nglobalThis.GameForTest = Game;', context);
    const game = Object.create(context.GameForTest.prototype);
    game.audioManager = audioManager;
    game.currentLevelIndex = 0;
    game.gameMode = 'campaign';
    await game.ensureLevelMusic();
    game.gameMode = 'survival';
    await game.ensureLevelMusic();
    assert.deepEqual(calls, [
        ['loadMusic', 'forest_theme', 'assets/audio/music/forest_theme.wav'],
        ['playMusic', 'forest_theme', true],
        ['loadMusic', 'city_theme', 'assets/audio/music/city_theme.wav'],
        ['playMusic', 'city_theme', true]
    ]);
});
