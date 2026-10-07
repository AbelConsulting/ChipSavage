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
    ['first ravine', 1500, 310, 1770, 1850, 20],
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
        if (name === 'first ravine') player.keys = { arrowright: true };
        player.jump();
        advance(player, level, jumpFrames);
        const target = player.findHookshotTarget(level);
        assert.equal(target.x, anchorX);
        const landing = level.platforms.find(p => p.type === 'static' && p.x === landingX &&
            (p.height === 24 || p.tile === 'ground_tile'));
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
            if (!released && !player.hookshotSwing) {
                assert.fail(`Swing detached early at ${player.x},${player.y}; support=${player._groundPlatform?.x}`);
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
    for (const [x, y] of [[1280, 360], [5630, 210], [7390, 460], [11040, 320]]) {
        assert.ok(stage.skunkPowerups.some(p => p.x === x && p.y === y));
    }
    const reward = stage.damageBoosts.find(p => p.x === 5960);
    const landing = stage.platforms.find(p => p.x === 5900 && p.y === 270);
    assert.ok(reward.x >= landing.x && reward.x + 32 <= landing.x + landing.width);
    assert.equal(reward.y, landing.y - 40);
});

test('no static platform sits inside a moving platform travel envelope', () => {
    const { stage } = loadStage();
    const statics = stage.platforms.filter(p => p.type === 'static');
    for (const lift of stage.platforms.filter(p => p.type === 'moving')) {
        const rx = lift.axis === 'x' ? lift.range : 0;
        const ry = lift.axis === 'y' ? lift.range : 0;
        const env = { x: lift.x - rx, y: lift.y - ry, width: lift.width + rx * 2, height: lift.height + ry * 2 };
        for (const p of statics) {
            const overlaps = p.x < env.x + env.width && p.x + p.width > env.x &&
                p.y < env.y + env.height && p.y + p.height > env.y;
            assert.ok(!overlaps, `Static ${p.x},${p.y} overlaps lift ${lift.x},${lift.y}`);
        }
    }
});

for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    test(`the introductory lift is reachable without ammo at motion phase ${phase}`, () => {
        const { level, player } = loadStage();
        const lift = level.platforms.find(p => p.type === 'moving' && p.x === 3340);
        level._motionTime = phase / lift.speed;
        level.update(0);
        player.x = 3290;
        player.y = 680 - player.height;
        player.golfAmmo = 0;
        player.onGround = true;
        player.jump();
        player.keys = { arrowright: true };
        for (let frame = 0; frame < 120; frame++) {
            if (frame === 18 && !player.onGround) player.jump();
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

const itemRoutes = [
    ['idols', 1210, 360, 'climb', 1138, 680, 400],
    ['idols', 4890, 120, 'climb', 4758, 320, 160],
    ['idols', 9030, 130, 'jump', 8830, 270],
    ['idols', 10750, 200, 'climb', 10648, 320, 240],
    ['idols', 12500, 120, 'climb', 12398, 240, 160],
    ['speedBoosts', 2820, 40, 'climb', 2728, 190, 80],
    ['speedBoosts', 11060, 190, 'jump', 11010, 360],
    ['damageBoosts', 5960, 230, 'hook', 5650, 250],
    ['damageBoosts', 12190, 395, 'jump', 12125, 570],
    ['skunkPowerups', 1280, 360, 'climb', 1138, 680, 400],
    ['skunkPowerups', 1750, 460, 'jump', 1450, 310],
    ['skunkPowerups', 2330, 260, 'double jump', 2290, 520],
    ['skunkPowerups', 5630, 210, 'jump', 5380, 300],
    ['skunkPowerups', 6710, 440, 'climb', 6836, 680, 480],
    ['skunkPowerups', 7390, 460, 'jump', 7150, 480],
    ['skunkPowerups', 8270, 240, 'jump', 8270, 430],
    ['skunkPowerups', 8270, 390, 'double jump', 8190, 670],
    ['skunkPowerups', 10320, 260, 'climb', 10236, 670, 300],
    ['skunkPowerups', 11040, 320, 'climb', 11216, 670, 360],
    ['skunkPowerups', 12680, 380, 'jump', 12470, 340]
];

const itemSpawners = {
    idols: 'spawnGoldenIdol',
    speedBoosts: 'spawnSpeedBoost',
    damageBoosts: 'spawnDamageBoost',
    skunkPowerups: 'spawnSkunkPowerup'
};
const itemBounceRanges = { idols: 5, speedBoosts: 12, damageBoosts: 10, skunkPowerups: 10 };

test('every placed pickup has a deliberate route, clear space and an elevated landing', () => {
    const { stage, level, items } = loadStage();
    const routes = itemRoutes.map(([group, x, y]) => `${group}:${x}:${y}`);
    routes.push('speedBoosts:7090:440'); // Mandatory fire passage, tested separately.
    for (const [group, spawner] of Object.entries(itemSpawners)) {
        for (const position of stage[group]) {
            const key = `${group}:${position.x}:${position.y}`;
            assert.ok(routes.includes(key), `Missing traversal test for ${key}`);
            const item = items[spawner](position.x, position.y);
            const bounce = itemBounceRanges[group];
            const bounds = {
                x: item.x - item.width / 2, y: item.y - item.height / 2 - bounce,
                width: item.width, height: item.height + bounce * 2
            };
            assert.equal(level.getWallAt(bounds), null, `Pickup embedded in a wall: ${key}`);
            const support = level.platforms.find(p =>
                p.type === 'static' && p.height === 24 && bounds.x >= p.x &&
                bounds.x + bounds.width <= p.x + p.width &&
                item.baseY + 40 === p.y
            );
            assert.ok(support, `Pickup has no full-width landing: ${key}`);
            assert.ok(support.y <= 500, `Pickup is still on the ground route: ${key}`);
        }
    }
    assert.equal(routes.length, Object.keys(itemSpawners).reduce((count, group) => count + stage[group].length, 0));
});

for (const [group, x, y, action, startX, startY, roofY] of itemRoutes) {
    for (const bounce of [-itemBounceRanges[group], itemBounceRanges[group]]) {
        test(`${group} at ${x},${y} is collectible via ${action} with bounce ${bounce}`, () => {
            const { level, player, items } = loadStage();
            const pickup = items[itemSpawners[group]](x, y);
            pickup.y += bounce;
            player.x = startX;
            player.y = startY - player.height;
            player.golfAmmo = action === 'hook' ? 1 : 0;
            player.onGround = true;
            const collected = () => items.checkPlayerCollision(player).includes(pickup);

            if (action === 'climb') {
                player.keys = { arrowup: true };
                advance(player, level, Math.ceil((startY - roofY) / player.climbSpeed * 60) + 8);
                assert.equal(player.y, roofY - player.height);
            } else {
                player.jump();
            }

            if (action === 'hook') {
                advance(player, level, 20);
                player.selectGolfShot('hookshot');
                player.shootGolfProjectile();
                for (let frame = 0; frame < 90 && !player.hookshotSwing; frame++) {
                    level.update(1 / 60);
                    player.update(1 / 60, level);
                }
                assert.ok(player.hookshotSwing);
            }

            let reached = false;
            for (let frame = 0; frame < 240; frame++) {
                if (action === 'double jump' && frame === 20) player.jump();
                const distance = x - 16 - player.x;
                player.keys = Math.abs(distance) < 12 ? {} : (distance > 0 ? { arrowright: true } : { arrowleft: true });
                if (player.hookshotSwing && player.x > 5800 - 140) player.releaseHookshotSwing(true);
                level.update(1 / 60);
                player.update(1 / 60, level);
                if (collected()) {
                    reached = true;
                    break;
                }
            }
            assert.ok(reached, `Route missed its pickup; player ended at ${player.x},${player.y}`);
            assert.equal(player.golfAmmo, 0, 'Ammo approaches and ladder bypasses must not require shots');
        });
    }
}

test('the post-gate speed reward requires opening the fire passage before collection', () => {
    const { level, player, items } = loadStage();
    const gate = level.platforms.find(p => p.ammoRefill);
    const pickup = items.spawnSpeedBoost(7090, 440);
    player.x = 6780;
    player.y = 480 - player.height;
    player.golfAmmo = 1;
    player.selectGolfShot('fireball');
    player.shootGolfProjectile();
    advance(player, level, 30);
    assert.ok(!level.platforms.includes(gate));
    player.keys = { arrowright: true };
    let reached = false;
    for (let frame = 0; frame < 90; frame++) {
        player.update(1 / 60, level);
        if (items.checkPlayerCollision(player).includes(pickup)) {
            reached = true;
            break;
        }
    }
    assert.ok(reached);
});

for (const [wallX, shot, startX, startY, alcoveX, alcoveY] of [
    [2770, 'gold', 2700, 300, 2728, 190],
    [4800, 'fireball', 4660, 320, 4758, 320],
    [10690, 'bomb', 10610, 320, 10648, 320],
    [12440, 'fireball', 12370, 340, 12398, 240]
]) {
    test(`bonus wall ${wallX} has an ammo-free approach and responds to ${shot}`, () => {
        const { level, player } = loadStage();
        const wall = level.platforms.find(p => p.type === 'wall' && p.x === wallX);
        player.x = startX;
        player.y = startY - player.height;
        player.onGround = true;
        player.golfAmmo = 0;
        if (startY !== alcoveY) player.jump();
        let arrived = false;
        for (let frame = 0; frame < 120; frame++) {
            const distance = alcoveX - player.x;
            player.keys = Math.abs(distance) < 8 ? {} : (distance > 0 ? { arrowright: true } : { arrowleft: true });
            level.update(1 / 60);
            player.update(1 / 60, level);
            if (player.onGround && Math.abs(player.y + player.height - alcoveY) < 0.01 &&
                level.getClimbableAt(player)?.x === alcoveX) {
                arrived = true;
                break;
            }
        }
        assert.ok(arrived, `Unreachable alcove approach: ${player.x},${player.y}`);
        player.keys = {};
        player.facingRight = true;
        player.golfAmmo = 1;
        player.selectGolfShot(shot);
        player.shootGolfProjectile();
        for (let frame = 0; frame < 120 && player.golfProjectiles.length; frame++) {
            player.updateProjectiles(1 / 60, level);
        }
        assert.ok(!level.platforms.includes(wall));
    });
}

for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    test(`the final damage reward is reachable from the lift at phase ${phase}`, () => {
        const { level, player, items } = loadStage();
        const lift = level.platforms.find(p => p.type === 'moving' && p.x === 12110);
        level._motionTime = phase / lift.speed;
        level.update(0);
        player.x = 12125;
        player.y = lift.y - player.height;
        player.onGround = true;
        player.golfAmmo = 0;
        const pickup = items.spawnDamageBoost(12190, 395);
        player.jump();
        let reached = false;
        for (let frame = 0; frame < 120; frame++) {
            if (frame === 20) player.jump();
            const distance = pickup.x - 16 - player.x;
            player.keys = Math.abs(distance) < 12 ? {} : (distance > 0 ? { arrowright: true } : { arrowleft: true });
            level.update(1 / 60);
            player.update(1 / 60, level);
            if (items.checkPlayerCollision(player).includes(pickup)) {
                reached = true;
                break;
            }
        }
        assert.ok(reached, `Lift reward missed at ${player.x},${player.y}`);
    });
}
