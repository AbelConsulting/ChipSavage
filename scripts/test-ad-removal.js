const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

function setup() {
    const window = new EventTarget();
    const document = new EventTarget();
    document.querySelector = () => null;
    const canvas = new EventTarget();
    const storage = new Map();
    const context = vm.createContext({
        window, document, console,
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, String(value))
        },
        setTimeout: () => 1,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    for (const name of ['config', 'game']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'), context);
    }
    const game = vm.runInContext('Object.create(Game.prototype)', context);
    Object.assign(game, {
        canvas, state: 'GAME_OVER', gameMode: 'arcade',
        audioManager: { playSound() {}, stopMusic() {} },
        _touchKeys: new Set(),
        dispatchGameStateChange() {},
        dispatchScoreChange() {}
    });
    return { game, window, canvas };
}

for (const mode of ['arcade', 'survival']) {
    for (const input of ['Enter', 'Space', 'click', 'touchstart']) {
        test(`${mode} ${input} restarts directly and respects game-over lockout`, () => {
            const { game, window, canvas } = setup();
            game.gameMode = mode;
            let locked = true;
            game._isGameOverLocked = () => locked;
            const starts = [];
            game.startGame = (...args) => starts.push(args);
            game.setupInput();
            const send = () => {
                const isKey = input === 'Enter' || input === 'Space';
                const event = new Event(isKey ? 'keydown' : input, { cancelable: true });
                if (isKey) Object.assign(event, { code: input, key: input === 'Space' ? ' ' : 'Enter' });
                (isKey ? window : canvas).dispatchEvent(event);
            };
            send();
            assert.equal(starts.length, 0);
            locked = false;
            send();
            assert.deepEqual(starts, [[0, mode]]);
            assert.equal(game.reviveFromAd, undefined);
        });
    }
}

for (const [mode, lives, state] of [
    ['arcade', 3, 'PLAYING'],
    ['arcade', 1, 'GAME_OVER'],
    ['survival', 1, 'GAME_OVER'],
    ['survival', 2, 'PLAYING']
]) {
    test(`${mode} death with ${lives} lives preserves normal life and pickup behavior`, () => {
        const { game } = setup();
        let finalDeath;
        Object.assign(game, {
            state: 'PLAYING', gameMode: mode, lives,
            score: 0, currentLevelIndex: 0, survivalWave: 2,
            player: {
                health: 0, x: 100, y: 596, comboCount: 0,
                startDeath(options) { finalDeath = options.final; }
            },
            gameStats: { maxCombo: 0, startTime: Date.now() / 1000 },
            enemyManager: { enemiesDefeated: 0 }
        });
        game._handlePlayerDeath();
        assert.equal(game.lives, lives - 1);
        assert.equal(game.state, state);
        assert.equal(finalDeath, state === 'GAME_OVER');
        assert.equal(!!game.isRespawning, state === 'PLAYING');
        assert.equal(game.gameStats.deathsThisRun, 1);
    });
}

test('level completion still schedules the normal transition without an ad service', () => {
    const { game } = setup();
    game.state = 'PLAYING';
    game.gameStats = { levelsCompleted: 0, perfectLevels: 0, levelDamageTaken: 0 };
    game.completeLevel();
    assert.equal(game.state, 'LEVEL_COMPLETE');
    assert.equal(game._levelCompleteWait, 2);
    assert.equal(game.gameStats.levelsCompleted, 1);
    assert.equal(game.gameStats.perfectLevels, 1);
    game.gameMode = 'survival';
    game.state = 'PLAYING';
    game.completeLevel();
    assert.equal(game.state, 'PLAYING');
    assert.equal(game.gameStats.levelsCompleted, 1);
});

test('browser and packaged runtime contain no ad manager, ad APIs, or ad revive hooks', () => {
    for (const base of [root, path.join(root, 'www')]) {
        assert.equal(fs.existsSync(path.join(base, 'js', 'adManager.js')), false);
        const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
        assert.doesNotMatch(html, /adManager|adsbygoogle|--ad-width/);
        for (const file of fs.readdirSync(path.join(base, 'js')).filter(name => name.endsWith('.js'))) {
            assert.doesNotMatch(
                fs.readFileSync(path.join(base, 'js', file), 'utf8'),
                /AdManager|AdMob|adsbygoogle|reviveFromAd|gameAdShow|gameAdHide|trackAdRevive|trackAdImpression|remove_ads|chipsavage\.adFree/,
                file
            );
        }
        assert.doesNotMatch(fs.readFileSync(path.join(base, 'js', 'itemManager.js'), 'utf8'), /PurchaseManager/);
    }
});
