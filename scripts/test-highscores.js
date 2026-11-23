const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const KEY = 'chipsavage_local_scores_v1';

function load(values = {}) {
    const storage = new Map(Object.entries(values));
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        localStorage: {
            getItem: key => (storage.has(key) ? storage.get(key) : null),
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        setTimeout: () => 1,
        clearTimeout() {}
    });
    context.window = context;
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'highscores.js'), 'utf8');
    vm.runInContext(source.replace(/^import .*;.*$/m, ''), context);
    return { hs: context.Highscores, storage, saved: () => JSON.parse(storage.get(KEY) || '[]') };
}

test('empty local board accepts the first score and stores it on the device', async () => {
    const { hs, saved } = load();
    assert.deepEqual(Array.from(await hs.loadScores('alltime')), []);
    assert.equal(await hs.isHighScore(1200), true);
    assert.equal(await hs.checkServiceHealth(), true);
    assert.equal(await hs.addScore(1200, 'Chip', { runId: 'run-a', levelsCompleted: 2 }), true);
    const [row] = saved();
    assert.equal(row.name, 'Chip');
    assert.equal(row.score, 1200);
    assert.equal(row.level, 2);
    assert.equal(row.runId, 'run-a');
    const board = await hs.loadScores('alltime');
    assert.equal(board.length, 1);
    assert.equal(board[0].score, 1200);
});

test('the same run is only recorded once', async () => {
    const { hs, saved } = load();
    const stats = { runId: 'run-dup' };
    await Promise.all([hs.addScore(500, 'Chip', stats), hs.addScore(500, 'Chip', stats)]);
    await hs.addScore(500, 'Chip', stats);
    assert.equal(saved().length, 1);
});

test('boards rank highest first, cap at ten, and only qualifying scores prompt', async () => {
    const { hs, saved } = load();
    for (let i = 1; i <= 12; i++) await hs.addScore(i * 100, `P${i}`, { runId: `run-${i}` });
    const board = await hs.loadScores('alltime');
    assert.deepEqual(Array.from(board, e => e.score), [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300]);
    assert.equal(saved().length, 10);
    assert.equal(await hs.isHighScore(250), false);
    assert.equal(await hs.isHighScore(350), true);
});

test('week and month tabs only show scores from the current period', async () => {
    const now = Date.now();
    const old = [
        { name: 'Old', score: 9000, timestamp: now - 400 * 86400000, runId: 'old' },
        { name: 'Recent', score: 4000, timestamp: now - 40 * 86400000, runId: 'recent' }
    ];
    const { hs } = load({ [KEY]: JSON.stringify(old) });
    await hs.addScore(100, 'Today', { runId: 'today' });
    assert.deepEqual(Array.from(await hs.loadScores('alltime'), e => e.name), ['Old', 'Recent', 'Today']);
    assert.deepEqual(Array.from(await hs.loadScores('month'), e => e.name), ['Today']);
    assert.deepEqual(Array.from(await hs.loadScores('week'), e => e.name), ['Today']);
    assert.equal(await hs.isHighScore(50), true);
});

test('corrupt or invalid saved rows are ignored instead of breaking the board', async () => {
    const bad = load({ [KEY]: '{not json' });
    assert.deepEqual(Array.from(await bad.hs.loadScores()), []);
    const mixed = load({ [KEY]: JSON.stringify([
        null, { name: 'x', score: -5, timestamp: 1 }, { name: 'y', score: 'big', timestamp: 1 },
        { name: 'ok', score: 10, timestamp: 1 }
    ]) });
    assert.deepEqual(Array.from(await mixed.hs.loadScores(), e => e.name), ['ok']);
});
