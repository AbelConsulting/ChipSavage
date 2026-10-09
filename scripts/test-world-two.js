const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(id) {
    class Effect { update() {} }
    const context = vm.createContext({
        console,
        window: {},
        SpeedTrailEffect: Effect,
        HealthRegenEffect: Effect,
        DamageBoostEffect: Effect,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    context.id = id;
    for (const name of ['config', 'utils', 'visualEffects', 'levelData', 'level', 'player', 'itemManager', 'game']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
    }
    vm.runInContext(`
        Player.prototype.loadSprites = function () { this.animations = {}; };
        globalThis.stage = LEVEL_CONFIGS.find(stage => stage.id === id);
        globalThis.level = new Level();
        level.loadLevel(stage);
        globalThis.player = new Player(0, 0, null);
        player.level = level;
        globalThis.items = new ItemManager();
        globalThis.game = Object.create(Game.prototype);
        Object.assign(game, { level, player, itemManager: items, hitSparks: [] });
        level.testGame = game;
    `, context);
    return context;
}

function tick(level, player) {
    level.update(1 / 60);
    player.update(1 / 60, level);
    player._updateAttackHitboxPosition();
    if (!player.isClimbing && level.getShieldTileAt(player.attackHitbox)) player.attack();
    level.testGame.updateShieldTiles();
    level.testGame.itemManager.update(1 / 60);
}

const spawners = {
    idols: 'spawnGoldenIdol', speedBoosts: 'spawnSpeedBoost',
    damageBoosts: 'spawnDamageBoost', skunkPowerups: 'spawnSkunkPowerup'
};
const bounceRanges = { idols: 5, speedBoosts: 12, damageBoosts: 10, skunkPowerups: 10 };
const routes = [
    ['level_2', 'idols', 1240, 390, 'climb', 1178, 660, 430],
    ['level_2', 'idols', 5300, 230, 'climb', 5168, 400, 270],
    ['level_2', 'idols', 9560, 170, 'climb', 9428, 340, 210],
    ['level_2', 'speedBoosts', 3100, 200, 'climb', 2958, 380, 240],
    ['level_2', 'speedBoosts', 7500, 180, 'climb', 7348, 360, 220],
    ['level_2', 'damageBoosts', 5590, 280, 'jump', 5320, 400],
    ['level_2', 'damageBoosts', 10940, 460, 'jump', 10720, 660],
    ['level_2', 'skunkPowerups', 850, 500, 'jump', 690, 660],
    ['level_2', 'skunkPowerups', 1740, 510, 'jump', 1560, 660],
    ['level_2', 'skunkPowerups', 4000, 430, 'jump', 3840, 540],
    ['level_2', 'skunkPowerups', 4220, 350, 'hook', 4010, 470, 4020],
    ['level_2', 'skunkPowerups', 4900, 360, 'climb', 5128, 670, 400],
    ['level_2', 'skunkPowerups', 7680, 250, 'jump', 7480, 360],
    ['level_2_boss', 'speedBoosts', 900, 340, 'jump', 650, 450],
    ['level_2_boss', 'damageBoosts', 2600, 230, 'climb', 2478, 390, 270],
    ['level_2_boss', 'skunkPowerups', 1720, 310, 'jump', 1360, 410]
];

for (const id of ['level_2', 'level_2_boss']) {
    test(`${id} every item has a challenge route, stable landing and animation clearance`, () => {
        const { stage, level, items } = setup(id);
        let count = 0;
        for (const [group, spawner] of Object.entries(spawners)) {
            for (const position of stage[group]) {
                count++;
                assert.ok(routes.some(([stageId, kind, x, y]) =>
                    stageId === id && kind === group && x === position.x && y === position.y
                ));
                const tile = group === 'idols' ? null : level.platforms.find(p =>
                    level.isShieldTile(p) && p.sourceX === position.x && p.sourceY === position.y
                );
                if (group !== 'idols') {
                    assert.ok(tile);
                    assert.equal(tile.powerupType, {
                        speedBoosts: 'SPEED_BOOST', damageBoosts: 'DAMAGE_BOOST', skunkPowerups: 'SKUNK_POWERUP'
                    }[group]);
                    assert.ok(level.platforms.some(p => !level.isShieldTile(p) &&
                        p.type === 'static' && p.y - tile.y - tile.height === 25 &&
                        position.x >= p.x && position.x <= p.x + p.width));
                    continue;
                }
                const item = items[spawner](position.x, position.y);
                const bounce = bounceRanges[group];
                const bounds = {
                    x: item.x - item.width / 2, y: item.y - item.height / 2 - bounce,
                    width: item.width, height: item.height + bounce * 2
                };
                assert.equal(level.getWallAt(bounds), null);
                assert.ok(level.platforms.some(p =>
                    p.type === 'static' && p.height === 24 &&
                    bounds.x >= p.x && bounds.x + bounds.width <= p.x + p.width &&
                    p.y === position.y + 40 && p.y <= 550
                ), `Missing landing for ${group}:${position.x}`);
            }
        }
        assert.equal(count, routes.filter(([stageId]) => stageId === id).length);
    });
}

for (const [id, group, x, y, action, startX, startY, target] of routes) {
    for (const bounce of [-bounceRanges[group], bounceRanges[group]]) {
        test(`${id} ${group} ${x} is collectible via ${action} at bounce ${bounce}`, () => {
            const { level, player, items } = setup(id);
            let item = group === 'idols' ? items.spawnGoldenIdol(x, y) : null;
            if (item) item.y += bounce;
            player.x = startX;
            player.y = startY - player.height;
            player.onGround = true;
            player.golfAmmo = action === 'hook' ? 1 : 0;
            if (action === 'climb') {
                player.keys = { arrowup: true };
                for (let frame = 0; frame < Math.ceil((startY - target) / player.climbSpeed * 60) + 8; frame++) {
                    tick(level, player);
                    if (player.y + player.height <= target) break;
                }
                assert.equal(player.y, target - player.height);
            } else {
                player.jump();
            }
            if (action === 'hook') {
                for (let frame = 0; frame < 20; frame++) tick(level, player);
                assert.equal(player.findHookshotTarget(level).x, target);
                player.selectGolfShot('hookshot');
                player.shootGolfProjectile();
                for (let frame = 0; frame < 90 && !player.hookshotSwing; frame++) tick(level, player);
                assert.ok(player.hookshotSwing);
            }
            let collected = false;
            for (let frame = 0; frame < 240; frame++) {
                const distance = x - 16 - player.x;
                player.keys = Math.abs(distance) < 12 ? {} : (distance > 0 ? { arrowright: true } : { arrowleft: true });
                if (player.hookshotSwing && player.x > target - 140) player.releaseHookshotSwing(true);
                tick(level, player);
                if (!item) item = items.items.find(p => p.sourceX === x && p.sourceY === y);
                if (item && (typeof item.popAge !== 'number' || item.popAge >= item.popDuration)) {
                    item.y = item.baseY + bounce;
                }
                if (item && items.checkPlayerCollision(player).includes(item)) {
                    collected = true;
                    break;
                }
                if (group !== 'idols' && player.onGround && player.y > y) player.jump();
            }
            assert.ok(collected, `Missed pickup at ${x},${y}; player=${player.x},${player.y}`);
            assert.equal(player.golfAmmo, 0);
        });
    }
}

for (const [id, x, baseY, roofY, material, shot] of [
    ['level_2', 3000, 380, 240, 'shock', 'gold'],
    ['level_2', 5210, 400, 270, 'shock', 'gold'],
    ['level_2', 7390, 360, 220, 'vine', 'fireball'],
    ['level_2', 9470, 340, 210, 'rock', 'bomb'],
    ['level_2_boss', 2520, 390, 270, 'shock', 'gold']
]) {
    test(`${id} ${material} bonus wall ${x} allows ammo-free climbing or its matching shot`, () => {
        const { level, player } = setup(id);
        const wall = level.platforms.find(p => p.type === 'wall' && p.x === x);
        player.x = x - 42;
        player.y = baseY - player.height;
        player.keys = { arrowup: true };
        for (let frame = 0; frame < Math.ceil((baseY - roofY) / player.climbSpeed * 60) + 8; frame++) tick(level, player);
        assert.equal(player.y, roofY - player.height);
        for (const wrong of ['gold', 'fireball', 'bomb', 'hookshot'].filter(s => s !== shot)) {
            assert.equal(level.hitWall(wall, wrong).destroyed, false);
        }
        assert.equal(level.hitWall(wall, shot).destroyed, true);
    });
}

test('boss combat space stays open with its trigger and exit unchanged', () => {
    const { stage, level } = setup('level_2_boss');
    assert.equal(stage.completion.bossTriggerX, 3200);
    assert.equal(stage.completion.exitX, 3900);
    assert.equal(stage.boss.spawnX, 3480);
    assert.equal(level.platforms.filter(p => p.type === 'anchor').length, 1);
    assert.equal(level.platforms.some(p => p.type === 'wall' && p.x + p.width > 3200), false);
    assert.ok(level.platforms.some(p => p.x === 0 && p.width === 4000 && p.y === 660));
    assert.ok(level.platforms.some(p => p.x === 3320 && p.y === 490 && p.width === 380));
});

for (const [id, startX, startY, anchorX, landingX] of [
    ['level_2', 1540, 390, 1910, 2040],
    ['level_2', 4010, 470, 4020, 4160],
    ['level_2', 5740, 320, 6200, 6380],
    ['level_2_boss', 1690, 350, 2040, 2140]
]) {
    test(`${id} anchor ${anchorX} provides a complete swing and safe landing`, () => {
        const { level, player } = setup(id);
        player.x = startX;
        player.y = startY - player.height;
        player.onGround = true;
        player.golfAmmo = 1;
        player.keys = anchorX === 4020 ? {} : { arrowright: true };
        player.jump();
        for (let frame = 0; frame < 20; frame++) tick(level, player);
        const target = player.findHookshotTarget(level);
        assert.equal(target.x, anchorX);
        player.selectGolfShot('hookshot');
        player.shootGolfProjectile();
        for (let frame = 0; frame < 90 && !player.hookshotSwing; frame++) tick(level, player);
        assert.ok(player.hookshotSwing);
        const landing = level.platforms.find(p => p.type === 'static' && p.x === landingX);
        let released = false;
        let landed = false;
        for (let frame = 0; frame < 240; frame++) {
            if (!released && player.hookshotSwing && player.x > target.x - 140) {
                player.releaseHookshotSwing(true);
                released = true;
            }
            const distance = landing.x + 40 - player.x;
            player.keys = Math.abs(distance) < 12 ? {} : (distance > 0 ? { arrowright: true } : { arrowleft: true });
            tick(level, player);
            if (released && player.onGround && player._groundPlatform === landing) {
                landed = true;
                break;
            }
        }
        assert.ok(released);
        assert.ok(landed, `Missed landing ${landingX}; ended at ${player.x},${player.y}`);
    });
}

for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    test(`Municipal Links first lift is reachable without ammo at phase ${phase}`, () => {
        const { level, player } = setup('level_2');
        const lift = level.platforms.find(p => p.type === 'moving' && p.initialX === 1840);
        level._motionTime = phase / lift.speed;
        level.update(0);
        player.x = 1740;
        player.y = 550 - player.height;
        player.onGround = true;
        player.golfAmmo = 0;
        player.jump();
        let landed = false;
        for (let frame = 0; frame < 180; frame++) {
            if (frame === 20) player.jump();
            const distance = lift.x + 32 - player.x;
            player.keys = Math.abs(distance) < 12 ? {} : (distance > 0 ? { arrowright: true } : { arrowleft: true });
            tick(level, player);
            if (player.onGround && player._groundPlatform === lift) {
                landed = true;
                break;
            }
        }
        assert.ok(landed);
    });
}
