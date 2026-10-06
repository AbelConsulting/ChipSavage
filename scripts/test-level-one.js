const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadStage() {
    class Effect {
        update() {}
    }
    const context = vm.createContext({
        console,
        __err(error) { throw error; },
        SpeedTrailEffect: Effect,
        HealthRegenEffect: Effect,
        DamageBoostEffect: Effect
    });
    for (const file of ['config', 'utils', 'levelData', 'level', 'player', 'itemManager']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${file}.js`), 'utf8'), context);
    }
    vm.runInContext(`
        Player.prototype.loadSprites = function () { this.animations = {}; };
        globalThis.stage = LEVEL_CONFIGS[0];
        globalThis.level = Object.create(Level.prototype);
        level.height = Config.SCREEN_HEIGHT;
        level.loadLevel(stage);
        globalThis.player = new Player(6800, 616, null);
        player.level = level;
        globalThis.items = new ItemManager();
    `, context);
    return context;
}

function advance(player, level, frames) {
    for (let i = 0; i < frames; i++) player.update(1 / 60, level);
}

test('level one has one fireball-only passage with solid upper and lower bypass blockers', () => {
    const { level, stage, player } = loadStage();
    const gates = level.platforms.filter(p => p.ammoRefill);
    assert.equal(gates.length, 1);
    const gate = gates[0];
    assert.equal(gate.material, 'vine');
    assert.ok(stage.skunkPowerups.some(p => p.x === gate.ammoRefill.x && p.y === gate.ammoRefill.y));
    for (let y = -400; y < level.height + 120; y += 8) {
        assert.ok(level.getWallAt({ x: gate.x, y, width: 64, height: 64 }), `Unblocked bypass at y=${y}`);
    }
    for (const shot of ['gold', 'bomb', 'hookshot']) {
        assert.equal(level.hitWall(gate, shot).destroyed, false);
    }
    assert.equal(player.findHookshotTarget(level), null);
    assert.ok(gate.x < stage.completion.exitX);
});

test('the ladder reaches a firing ledge and a real fireball opens a walkable passage', () => {
    const { level, player, items } = loadStage();
    const gate = level.platforms.find(p => p.ammoRefill);
    const ladder = level.platforms.find(p => p.type === 'climb' && p.x === 6836);
    player.keys = { arrowup: true };
    advance(player, level, 60);
    assert.equal(player.y, 480 - player.height);
    player.keys = { arrowleft: true };
    advance(player, level, 18);
    assert.equal(player.isClimbing, false);
    assert.equal(player.onGround, true);

    const pickup = items.spawnSkunkPowerup(gate.ammoRefill.x, gate.ammoRefill.y);
    assert.ok(items.checkPlayerCollision(player).includes(pickup));
    items.applyItemEffect(player, pickup);
    assert.equal(player.golfAmmo, 2);
    player.keys = {};
    player.facingRight = true;
    player.selectGolfShot('fireball');
    player.shootGolfProjectile();
    advance(player, level, 30);
    assert.ok(!level.platforms.includes(gate));
    assert.ok(level.platforms.includes(ladder), 'The ascent ladder must survive burning the gate');

    player.keys = { arrowright: true };
    advance(player, level, 75);
    assert.ok(player.x > gate.x + gate.width);
    assert.equal(player.onGround, true);
    assert.equal(player.y, 480 - player.height);
});

test('running into the closed gate cannot cross it on the ground or firing ledge', () => {
    for (const y of [616, 416, 240]) {
        const { level, player } = loadStage();
        player.x = 6800;
        player.y = y;
        player.keys = { arrowright: true };
        advance(player, level, 60);
        assert.ok(player.x + player.width <= 6880, `Crossed closed gate from y=${y}`);
    }
});

test('the gate refill prevents an ammo softlock without duplicating pickups or restocking after opening', () => {
    const { level, player, items } = loadStage();
    const gate = level.platforms.find(p => p.ammoRefill);
    player.golfAmmo = 0;
    level.updateProgressionPickups(player, items);
    level.updateProgressionPickups(player, items);
    assert.equal(items.items.length, 1);
    const pickup = items.items[0];
    pickup.collected = true;
    items.update(1 / 60);
    player.golfAmmo = 2;
    level.updateProgressionPickups(player, items);
    assert.equal(items.items.length, 0);
    player.golfAmmo = 0;
    level.updateProgressionPickups(player, items);
    assert.equal(items.items.length, 1);
    level.hitWall(gate, 'fireball');
    items.items = [];
    level.updateProgressionPickups(player, items);
    assert.equal(items.items.length, 0);
});

test('reloading level one restores the gate and other stages do not gain refill stations', () => {
    const { level, stage, player, items } = loadStage();
    const gate = level.platforms.find(p => p.ammoRefill);
    level.hitWall(gate, 'fireball');
    level.loadLevel(stage);
    assert.equal(level.platforms.filter(p => p.ammoRefill).length, 1);
    level.platforms = [];
    level.updateProgressionPickups(player, items);
    assert.equal(items.items.length, 0);
});

test('solid gate framing has no misleading shot-type icon', () => {
    const { level } = loadStage();
    const labels = [];
    const ctx = {
        save() {}, restore() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {},
        createLinearGradient() { return { addColorStop() {} }; },
        fillText(text) { labels.push(text); }
    };
    const wall = level.platforms.find(p => p.material === 'solid');
    level.drawDestructibleWall(ctx, wall);
    assert.equal(labels.length, 0);
    level.drawDestructibleWall(ctx, { ...wall, material: 'rock' });
    assert.equal(labels.length, 1);
});
