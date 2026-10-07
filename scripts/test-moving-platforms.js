const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(platforms) {
    class Effect {
        update() {}
    }
    const context = vm.createContext({
        console,
        window: {},
        SpeedTrailEffect: Effect,
        HealthRegenEffect: Effect,
        DamageBoostEffect: Effect,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    for (const name of ['config', 'utils', 'level', 'player', 'game']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
    }
    context.platforms = platforms;
    vm.runInContext(`
        Player.prototype.loadSprites = function () { this.animations = {}; };
        globalThis.level = Object.create(Level.prototype);
        level.loadLevel({ width: 2000, height: 2000, platforms });
        globalThis.player = new Player(520, 436, null);
        player.level = level;
        globalThis.GameClass = Game;
    `, context);
    return context;
}

function moving(axis, extra = {}) {
    return { x: 500, y: 500, width: 240, height: 24, type: 'moving', axis, range: 80, speed: 2, ...extra };
}

function tick(level, player, dt = 1 / 60) {
    level.update(dt);
    player.update(dt, level);
}

for (const axis of ['x', 'y']) {
    test(`${axis} platforms follow gameplay time and report exact frame displacement`, () => {
        const { level } = setup([moving(axis)]);
        const platform = level.platforms[0];
        level.update(0.25);
        assert.ok(Math.abs(platform[axis] - (500 + Math.sin(0.5) * 80)) < 1e-9);
        assert.ok(Math.abs(platform[axis === 'x' ? 'dx' : 'dy'] - Math.sin(0.5) * 80) < 1e-9);
        const position = platform[axis];
        level.update(0);
        assert.equal(platform[axis], position);
        assert.equal(platform.dx, 0);
        assert.equal(platform.dy, 0);
    });

    test(`player rides ${axis} platforms through full cycles and reversals`, () => {
        const { level, player } = setup([moving(axis)]);
        const platform = level.platforms[0];
        player.y = platform.y - player.height;
        player.update(1 / 60, level);
        assert.equal(player.onGround, true);
        const offsetX = player.x - platform.x;
        for (let frame = 0; frame < 600; frame++) {
            tick(level, player);
            assert.equal(player.onGround, true, `frame ${frame}`);
            assert.ok(Math.abs(player.y + player.height - platform.y) < 1e-8);
            assert.ok(Math.abs(player.x - platform.x - offsetX) < 1e-8);
        }
    });
}

test('configured phases survive loading and reloading, without an initial position jump', () => {
    const config = { width: 2000, height: 2000, platforms: [moving('y', { timeOffset: 1 })] };
    const { level } = setup(config.platforms);
    const start = level.platforms[0].y;
    assert.ok(Math.abs(start - (500 + Math.sin(1) * 80)) < 1e-9);
    level.update(0);
    assert.equal(level.platforms[0].y, start);
    level.update(0.5);
    level.loadLevel(config);
    assert.equal(level.platforms[0].y, start);
    assert.equal(level._motionTime, 0);
    assert.equal(config.platforms[0].y, 500);
});

test('zero range and zero speed are respected and static tiles stay still', () => {
    const { level } = setup([
        moving('x', { range: 0 }),
        moving('y', { speed: 0 }),
        { x: 200, y: 700, width: 200, height: 24, type: 'static' }
    ]);
    level.update(1);
    assert.equal(level.platforms[0].x, 500);
    assert.equal(level.platforms[1].y, 500);
    assert.equal(level.platforms[2].x, 200);
    assert.equal(level.platforms[2].y, 700);
});

test('jumping and walking off detach the player from platform motion', () => {
    for (const action of ['jump', 'walk']) {
        const { level, player } = setup([moving('x')]);
        const platform = level.platforms[0];
        player.y = platform.y - player.height;
        player.update(1 / 60, level);
        if (action === 'jump') {
            player.jump();
        } else {
            player.x = platform.x + platform.width + 10;
        }
        const x = player.x;
        tick(level, player);
        assert.equal(player.onGround, false);
        assert.equal(player._groundPlatform, null);
        assert.equal(player.x, x);
    }
});

test('a rising platform catches a falling player using its previous top position', () => {
    const { level } = setup([moving('y', { timeOffset: Math.PI })]);
    const platform = level.platforms[0];
    level.update(0.1);
    assert.ok(platform.y < platform.previousY);
    const collision = level.checkPlatformCollision(
        { x: 520, y: 433, width: 64, height: 64 },
        { x: 520, y: 431, width: 64, height: 64 },
        120
    );
    assert.equal(collision.collided, true);
    assert.equal(collision.landingY, platform.y - 64);
    assert.equal(level.checkPlatformCollision(
        { x: 520, y: 433, width: 64, height: 64 },
        { x: 520, y: 435, width: 64, height: 64 },
        -120
    ).collided, false);
});

test('running off a moving platform releases support and restores falling', () => {
    const { level, player } = setup([moving('x')]);
    const platform = level.platforms[0];
    player.y = platform.y - player.height;
    player.update(1 / 60, level);
    player.keys = { arrowright: true };
    for (let frame = 0; frame < 120 && player.onGround; frame++) tick(level, player);
    assert.equal(player.onGround, false);
    assert.equal(player._groundPlatform, null);
    assert.ok(player.x >= platform.x + platform.width);
    const y = player.y;
    tick(level, player);
    assert.ok(player.y > y);
});

test('gameplay updates the level before the player and paused games do not move platforms', () => {
    const { level, GameClass } = setup([moving('x')]);
    const game = Object.create(GameClass.prototype);
    Object.assign(game, {
        state: 'PAUSED',
        level,
        gameStats: { timeSurvived: 0 },
        damageNumbers: [],
        hitSparks: []
    });
    game.update(1 / 60);
    assert.equal(level._motionTime, 0);
    const stop = new Error('Reached player update');
    game.player = {
        update() {
            assert.equal(level._motionTime, 1 / 60);
            throw stop;
        }
    };
    game.state = 'PLAYING';
    assert.throws(() => game.update(1 / 60), error => error === stop);
});

test('packaged moving-platform sources match browser sources', () => {
    for (const name of ['level', 'player', 'game', 'levelData']) {
        assert.equal(
            fs.readFileSync(path.join(__dirname, '..', 'www', 'js', `${name}.js`), 'utf8'),
            fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')
        );
    }
});
