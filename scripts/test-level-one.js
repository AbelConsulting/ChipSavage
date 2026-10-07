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
        save() {}, restore() {}, translate() {}, scale() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {},
        createLinearGradient() { return { addColorStop() {} }; },
        fillText(text) { labels.push(text); }
    };
    const wall = level.platforms.find(p => p.material === 'solid');
    level.drawDestructibleWall(ctx, wall);
    assert.equal(labels.length, 0);
    level.drawDestructibleWall(ctx, { ...wall, material: 'rock' });
    assert.equal(labels.length, 1);
});

test('the optional early rock shortcut has a usable ammo-free ladder route', () => {
    const { level, player } = loadStage();
    const wall = level.platforms.find(p => p.type === 'wall' && p.x === 2210);
    player.x = 2168;
    player.y = 680 - player.height;
    player.golfAmmo = 0;
    player.keys = { arrowup: true };
    advance(player, level, 45);
    assert.equal(player.y, 520 - player.height);
    player.keys = { arrowright: true };
    advance(player, level, 60);
    assert.ok(player.x > wall.x + wall.width);
    player.keys = {};
    advance(player, level, 60);
    assert.equal(player.onGround, true);
    assert.equal(player.golfAmmo, 0);
    assert.equal(level.hitWall(wall, 'fireball').destroyed, false);
    assert.equal(level.hitWall(wall, 'bomb').destroyed, true);
});

for (const [name, launchX, launchY, anchorX, landingX, jumpFrames] of [
    ['first ravine', 1400, 310, 1770, 1960, 8],
    ['canopy reward', 5650, 250, 5800, 5900, 20],
    ['post-gate ravine', 7500, 500, 7650, 7850, 20],
    ['late vine wall', 11170, 360, 11280, 11480, 20]
]) {
    test(`${name} hookshot route targets and attaches to its intended anchor`, () => {
        const { level, player } = loadStage();
        player.x = launchX;
        player.y = launchY - player.height;
        player.facingRight = true;
        player.selectGolfShot('hookshot');
        player.golfAmmo = 2;
        player.onGround = true;
        player.jump();
        advance(player, level, jumpFrames);
        const target = player.findHookshotTarget(level);
        assert.equal(target.x, anchorX);
        const landing = level.platforms.find(p => p.type === 'static' && p.x === landingX && p.height === 24);
        assert.ok(landing);
        player.shootGolfProjectile();
        for (let frame = 0; frame < 90 && !player.hookshotSwing; frame++) {
            level.update(1 / 60);
            player.update(1 / 60, level);
        }
        assert.ok(player.hookshotSwing, 'The hook must reach the anchor without hitting a wall');
        assert.equal(player.hookshotSwing.x, target.x + target.width / 2);
        assert.equal(player.golfAmmo, 1);

        player.keys = { arrowright: true };
        let released = false;
        for (let frame = 0; frame < 240; frame++) {
            level.update(1 / 60);
            player.update(1 / 60, level);
            if (!released && player.hookshotSwing && player.x > target.x - 140) {
                player.releaseHookshotSwing(true);
                released = true;
            }
            if (released && player.onGround && player._groundPlatform === landing) break;
        }
        assert.ok(released, `The swing must reach the release window: ${player.x}, ${player.y}`);
        assert.ok(player.onGround, 'The route must end on a safe surface');
        assert.ok(player.x >= landingX - player.width, 'The player must reach the far landing');
        assert.equal(player._groundPlatform, landing);
    });
}

test('hookshot launch areas have ammo and the canopy reward sits on its landing platform', () => {
    const { stage } = loadStage();
    for (const [x, y] of [[1280, 360], [5590, 210], [7390, 460], [11040, 320]]) {
        assert.ok(stage.skunkPowerups.some(p => p.x === x && p.y === y));
    }
    const reward = stage.damageBoosts.find(p => p.x === 5960);
    const landing = stage.platforms.find(p => p.x === 5900 && p.y === 270);
    assert.ok(reward.x >= landing.x && reward.x + 32 <= landing.x + landing.width);
    assert.equal(reward.y, landing.y - 40);
});

for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    test(`the introductory lift is reachable without ammo at motion phase ${phase}`, () => {
        const { level, player } = loadStage();
        const lift = level.platforms.find(p => p.type === 'moving' && p.x === 3340);
        level._motionTime = phase / lift.speed;
        level.update(0);
        player.x = 3290;
        player.y = 590 - player.height;
        player.golfAmmo = 0;
        player.onGround = true;
        player.jump();
        player.keys = { arrowright: true };
        for (let frame = 0; frame < 120; frame++) {
            if (player.x >= 3400) player.keys = {};
            level.update(1 / 60);
            player.update(1 / 60, level);
            if (player.onGround && player._groundPlatform === lift) break;
        }
        assert.equal(player._groundPlatform, lift);
        assert.equal(player.onGround, true);
        assert.equal(player.golfAmmo, 0);
    });
}
