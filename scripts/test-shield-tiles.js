const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const shield = { x: 300, y: 436, width: 48, height: 48, type: 'wall', tile: 'shield_tile' };

function setup(platforms = [shield]) {
    class Effect { update() {} }
    const context = vm.createContext({
        console, window: {},
        SpeedTrailEffect: Effect, HealthRegenEffect: Effect, DamageBoostEffect: Effect,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    for (const name of ['config', 'utils', 'visualEffects', 'levelData', 'level', 'player', 'itemManager', 'game', 'levelEditor']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'), context);
    }
    context.platforms = platforms;
    vm.runInContext(`
        Player.prototype.loadSprites = function () { this.animations = {}; };
        globalThis.level = new Level(2000, 720);
        level.loadLevel({ platforms });
        globalThis.player = new Player(100, 436, null);
        player.level = level;
        globalThis.items = new ItemManager();
        globalThis.game = Object.create(Game.prototype);
        Object.assign(game, { level, player, itemManager: items, hitSparks: [] });
        globalThis.stage = LEVEL_CONFIGS[0];
    `, context);
    return context;
}

for (const type of ['static', 'wall']) {
    for (const shot of ['gold', 'fireball', 'bomb', 'hookshot']) {
        test(`${shot} breaks a ${type} shield and releases exactly one ball`, () => {
            const platforms = [{ ...shield, type }];
            if (shot === 'hookshot') platforms.push({ x: 650, y: 436, width: 48, height: 48, type: 'anchor' });
            const { player, level, game, items } = setup(platforms);
            player.golfAmmo = 2;
            player.selectGolfShot(shot);
            player.shootGolfProjectile();
            for (let frame = 0; frame < 120 && player.golfProjectiles.length; frame++) {
                player.updateProjectiles(1 / 60, level);
            }
            assert.equal(level.platforms.some(tile => level.isShieldTile(tile)), false);
            assert.equal(player.golfProjectiles.length, 0);
            assert.equal(player.golfSprays[0].wallMaterial, 'shield');
            game.updateShieldTiles();
            game.updateShieldTiles();
            assert.equal(items.items.length, 1);
            assert.equal(items.items[0].x, shield.x + shield.width / 2);
            assert.equal(items.items[0].baseY, shield.y + shield.height / 2);
            assert.equal(player.golfAmmo, 1);
        });
    }
}

for (const kick of [false, true]) {
    test(`${kick ? 'kick' : 'attack'} breaks shields only during its damage window`, () => {
        const { player, level, game, items } = setup();
        player.isAttacking = true;
        player.isKicking = kick;
        player.attackHitbox = { x: 280, y: 436, width: 60, height: 48 };
        let active = false;
        player.isAttackDamageActive = () => active;
        game.updateShieldTiles();
        assert.equal(items.items.length, 0);
        active = true;
        game.updateShieldTiles();
        game.updateShieldTiles();
        assert.equal(level.platforms.length, 0);
        assert.equal(items.items.length, 1);
        assert.equal(game.hitSparks.length, 1);
        assert.equal(player.golfSprays.length, 0, 'Melee breaks must not create a damaging projectile explosion');
    });
}

for (const action of ['attack', 'specialAttack']) {
    test(`a real ${action} breaks a hovering shield from its supporting platform`, () => {
        const { player, level, game, items } = setup();
        const data = {
            platforms: [{ x: 0, y: 500, width: 1000, height: 24, type: 'static' }],
            speedBoosts: [{ x: 350, y: 460 }]
        };
        for (const facingRight of [true, false]) {
            level.loadLevel(data);
            const definition = level.platforms.find(p => level.isShieldTile(p));
            items.items.length = 0;
            player.x = facingRight ? definition.x - player.width : definition.x + definition.width;
            player.y = 500 - player.height;
            player.velocityX = 0;
            player.velocityY = 0;
            player.onGround = true;
            player.facingRight = facingRight;
            player.attackCooldownTimer = 0;
            player[action]();
            for (let frame = 0; frame < 30 && !items.items.length; frame++) {
                player.update(1 / 60, level);
                game.updateShieldTiles();
            }
            assert.equal(items.items.length, 1);
            assert.equal(level.platforms.some(p => p.tile === 'shield_tile' && p.x === definition.x), false);
            items.update(0.45);
            player.x = definition.x;
            assert.equal(items.checkPlayerCollision(player).length, 1);
        }
    });
}

test('a swept kick breaks multiple shields without skipping or duplicating drops', () => {
    const { player, level, game, items } = setup([shield, { ...shield, x: 365 }]);
    player.isAttacking = true;
    player.isKicking = true;
    player.isAttackDamageActive = () => true;
    player._prevAttackHitbox = { x: 280, y: 436, width: 48, height: 48 };
    player.attackHitbox = { x: 400, y: 436, width: 48, height: 48 };
    game.updateShieldTiles();
    assert.equal(level.platforms.length, 0);
    assert.equal(items.items.length, 2);
});

test('fast projectiles cannot tunnel through a shield', () => {
    const { player, level } = setup();
    player.golfProjectiles.push({
        x: 200, y: 460, width: 12, height: 12,
        velocityX: 10000, velocityY: 0, gravityScale: 0,
        shotType: 'gold', age: 0, lifetime: 2
    });
    player.updateProjectiles(0.02, level);
    assert.equal(level.platforms.length, 0);
    assert.equal(level.pendingPowerupDrops.length, 1);
});

test('shield destruction invalidates cached art, preserves nearby ladders, and resets on reload', () => {
    const definitions = [shield, { x: 258, y: 436, width: 36, height: 48, type: 'climb' }];
    const { level, items, game } = setup(definitions);
    level._staticNeedsUpdate = false;
    const tile = level.platforms[0];
    assert.equal(level.hitWall(tile, 'melee').destroyed, true);
    assert.equal(level.hitWall(tile, 'melee').destroyed, false);
    assert.equal(level._staticNeedsUpdate, true);
    assert.equal(level.platforms.length, 1);
    assert.equal(level.pendingPowerupDrops.length, 1);
    level.loadLevel({ platforms: definitions });
    game.updateShieldTiles();
    assert.equal(items.items.length, 0);
    assert.equal(level.platforms.length, 2);
});

test('random drops cover all four ball powerups and pop before becoming collectible', () => {
    const context = setup([]);
    const { items, player } = context;
    const expected = ['HEALTH_REGEN', 'SPEED_BOOST', 'DAMAGE_BOOST', 'SKUNK_POWERUP'];
    for (let index = 0; index < expected.length; index++) {
        vm.runInContext(`Math.random = () => ${(index + 0.5) / expected.length};`, context);
        const item = items.spawnRandomPowerup(132, 460);
        assert.equal(item.type, expected[index]);
        assert.equal(items.checkPlayerCollision(player).length, 0);
        items.update(0.225);
        assert.ok(item.y < item.baseY - 35, 'The ball visibly pops upward');
        items.update(0.225);
        assert.ok(Math.abs(item.y - item.baseY) <= 12, 'The ball settles back to its hover position');
        assert.ok(items.checkPlayerCollision(player).includes(item));
        items.applyItemEffect(player, item);
    }
});

test('shield tiles are solid until broken and normal elemental or solid walls are unchanged', () => {
    const { level } = setup([shield]);
    const previous = { x: 230, y: 436, width: 64, height: 64 };
    const current = { ...previous, x: 250 };
    assert.equal(level.resolveSolidCollision(current, previous).collidedX, true);
    level.hitWall(level.platforms[0], 'melee');
    assert.equal(level.resolveSolidCollision(current, previous).collidedX, false);
    for (const material of ['solid', 'vine', 'rock', 'shock']) {
        level.loadLevel({ platforms: [{ ...shield, material, tile: material === 'solid' ? 'shield_tile' : undefined }] });
        assert.equal(level.hitWall(level.platforms[0], 'melee').destroyed, false);
        assert.equal(level.pendingPowerupDrops.length, 0);
    }
});

test('shield art is drawn as one scaled sprite in both direct and cached rendering', () => {
    const { level } = setup();
    const image = {};
    level._getSprite = name => { assert.equal(name, 'shield_tile'); return image; };
    const draws = [];
    const ctx = {
        fillRect() {},
        drawImage(...args) { draws.push(args); }
    };
    level.drawPlatform(ctx, shield);
    assert.deepEqual(draws[0], [image, 300, 436, 48, 48]);
    const context = setup();
    context.level._getSprite = () => image;
    context.document = { createElement: () => ({ getContext: () => ctx }) };
    context.level.renderStaticLayer();
    assert.equal(draws.length, 2);
    assert.equal(context.level._staticNeedsUpdate, false);
});

test('shield sprite is preloaded and packaged', () => {
    const loader = fs.readFileSync(path.join(root, 'js', 'spriteLoader.js'), 'utf8');
    assert.ok(loader.includes("['shield_tile', 'assets/sprites/backgrounds/tiles/shield_tile.png']"));
    const asset = path.join('assets', 'sprites', 'backgrounds', 'tiles', 'shield_tile.png');
    assert.deepEqual(fs.readFileSync(path.join(root, asset)), fs.readFileSync(path.join(root, 'www', asset)));
    for (const name of ['game', 'level', 'levelData', 'player', 'itemManager', 'spriteLoader', 'levelEditor', 'tutorialHints']) {
        assert.equal(fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'),
            fs.readFileSync(path.join(root, 'www', 'js', `${name}.js`), 'utf8'));
    }
});

test('every configured ball becomes exactly one shield with the original powerup type', () => {
    const context = setup();
    vm.runInContext('globalThis.stages = LEVEL_CONFIGS;', context);
    const { level, game, items, stages } = context;
    let count = 0;
    for (const stage of stages) {
        level.loadLevel(stage);
        const shields = level.platforms.filter(p => level.isShieldTile(p));
        const expected = [
            ...(stage.speedBoosts || []).map(spawn => ({ ...spawn, type: 'SPEED_BOOST' })),
            ...(stage.damageBoosts || []).map(spawn => ({ ...spawn, type: 'DAMAGE_BOOST' })),
            ...(stage.skunkPowerups || []).map(spawn => ({ ...spawn, type: 'SKUNK_POWERUP' }))
        ];
        assert.equal(shields.length, expected.length, stage.id);
        for (const spawn of expected) {
            const tile = shields.find(p => p.sourceX === spawn.x && p.sourceY === spawn.y && p.powerupType === spawn.type);
            assert.ok(tile, `${stage.id}: ${spawn.type} at ${spawn.x},${spawn.y}`);
            const support = level.platforms.filter(p =>
                !level.isShieldTile(p) && ['static', 'moving', 'wall'].includes(p.type) &&
                spawn.x >= p.x && spawn.x <= p.x + p.width && p.y >= spawn.y
            ).sort((a, b) => a.y - b.y)[0];
            if (support) {
                assert.equal(tile.x + tile.width / 2, spawn.x);
                assert.equal(support.y - tile.y - tile.height, 25);
            } else {
                assert.ok(level.platforms.some(p => !level.isShieldTile(p) &&
                    ['static', 'moving', 'wall'].includes(p.type) &&
                    p.y - tile.y - tile.height === 25 &&
                    tile.x + tile.width / 2 >= p.x && tile.x + tile.width / 2 <= p.x + p.width));
            }
            items.items.length = 0;
            level.hitWall(tile, 'melee');
            game.updateShieldTiles();
            game.updateShieldTiles();
            assert.equal(items.items.length, 1);
            assert.equal(items.items[0].type, spawn.type);
            count++;
        }
        level.loadLevel(stage);
        assert.equal(level.platforms.filter(p => level.isShieldTile(p)).length, expected.length);
    }
    assert.ok(count > 100);
});

test('shields on moving supports track both axes while retaining the 25px gap', () => {
    for (const axis of ['x', 'y']) {
        const { level } = setup([]);
        level.loadLevel({
            platforms: [{ x: 300, y: 500, width: 200, height: 24, type: 'moving', axis, range: 60, speed: 1 }],
            damageBoosts: [{ x: 350, y: 460 }]
        });
        const tile = level.platforms.find(p => level.isShieldTile(p));
        const support = tile.supportPlatform;
        const offset = tile.x - support.x;
        assert.equal(level.isDynamicPlatform(tile), true);
        for (let frame = 0; frame < 180; frame++) {
            level.update(1 / 60);
            assert.equal(support.y - tile.y - tile.height, 25);
            assert.equal(tile.x - support.x, offset);
        }
    }
});

test('placed pickup shields do not block player traversal and ordinary loose drops remain unchanged', () => {
    const { level, items } = setup([]);
    level.loadLevel({
        platforms: [{ x: 0, y: 500, width: 1000, height: 24, type: 'static' }],
        skunkPowerups: [{ x: 350, y: 460 }]
    });
    const tile = level.platforms.find(p => level.isShieldTile(p));
    const rect = { x: tile.x, y: tile.y, width: 64, height: 64 };
    assert.equal(level.resolveSolidCollision(rect, { ...rect, x: rect.x - 64 }).collidedX, false);
    assert.equal(level.resolveSolidCollision(rect, { ...rect, y: rect.y - 64 }).collidedY, false);
    const loose = items.spawnSkunkPowerup(350, 460);
    assert.equal(loose.popAge, undefined);
    assert.equal(loose.sourceX, undefined);
    assert.equal(level.platforms.filter(p => level.isShieldTile(p)).length, 1);
});

test('game level loading spawns only idols directly, restores shields, and clears old balls', () => {
    const context = setup([]);
    const { level, items, game, stage } = context;
    context.ExitPortal = class {};
    game.gameStats = {};
    game._clearAllInput = () => {};
    game.loadLevel(0, { skipMusic: true });
    assert.equal(items.items.every(item => item.type === 'GOLDEN_IDOL'), true);
    const shields = level.platforms.filter(p => level.isShieldTile(p));
    assert.equal(shields.length, stage.speedBoosts.length + stage.damageBoosts.length + stage.skunkPowerups.length);
    level.hitWall(shields[0], 'melee');
    game.updateShieldTiles();
    assert.ok(items.items.some(item => item.type === shields[0].powerupType));
    game.loadLevel(0, { skipMusic: true });
    assert.equal(items.items.every(item => item.type === 'GOLDEN_IDOL'), true);
    assert.equal(level.platforms.filter(p => level.isShieldTile(p)).length, shields.length);
});

test('ammo refills respawn shields, not loose balls, without duplicating pending or uncollected drops', () => {
    const { level, player, items, game, stage } = setup();
    level.loadLevel(stage);
    const gate = level.platforms.find(p => p.ammoRefill);
    const findShield = () => level.platforms.find(p => level.isShieldTile(p) &&
        p.sourceX === gate.ammoRefill.x && p.sourceY === gate.ammoRefill.y);
    player.golfAmmo = 0;
    level.updateProgressionPickups(player, items);
    assert.ok(findShield());
    assert.equal(items.items.length, 0);
    level.hitWall(findShield(), 'melee');
    level.updateProgressionPickups(player, items);
    assert.equal(findShield(), undefined, 'Queued ball must prevent a duplicate shield');
    game.updateShieldTiles();
    level.updateProgressionPickups(player, items);
    assert.equal(findShield(), undefined, 'Uncollected ball must prevent a duplicate shield');
    items.items[0].collected = true;
    items.update(1 / 60);
    player.golfAmmo = 2;
    level.updateProgressionPickups(player, items);
    assert.equal(findShield(), undefined);
    player.golfAmmo = 0;
    level.updateProgressionPickups(player, items);
    const refill = findShield();
    assert.ok(refill);
    level.updateProgressionPickups(player, items);
    assert.equal(level.platforms.filter(p => p.sourceX === refill.sourceX && p.sourceY === refill.sourceY).length, 1);
    level.hitWall(refill, 'melee');
    game.updateShieldTiles();
    items.items.length = 0;
    level.hitWall(gate, 'fireball');
    level.updateProgressionPickups(player, items);
    assert.equal(findShield(), undefined);
});

test('mandatory gate ammo can be released with a real melee attack, collected, and fired at the gate', () => {
    const { level, player, items, game, stage } = setup();
    level.loadLevel(stage);
    const gate = level.platforms.find(p => p.ammoRefill);
    const tile = level.platforms.find(p => p.sourceX === gate.ammoRefill.x && p.sourceY === gate.ammoRefill.y);
    player.x = tile.x - player.width;
    player.y = tile.y + tile.height + 25 - player.height;
    player.facingRight = true;
    player.golfAmmo = 0;
    player.attack();
    game.updateShieldTiles();
    assert.equal(items.items.length, 1);
    assert.equal(items.items[0].type, 'SKUNK_POWERUP');
    items.update(0.45);
    player.x = tile.x;
    const collected = items.checkPlayerCollision(player);
    assert.equal(collected.length, 1);
    items.applyItemEffect(player, collected[0]);
    assert.equal(player.golfAmmo, 2);
    player.selectGolfShot('fireball');
    player.shootGolfProjectile();
    for (let frame = 0; frame < 120 && level.platforms.includes(gate); frame++) {
        player.updateProjectiles(1 / 60, level);
    }
    assert.equal(level.platforms.includes(gate), false);
});

test('editor enables shields for static platforms and non-solid walls but protects special geometry', () => {
    const context = setup();
    const alerts = [];
    context.alert = message => alerts.push(message);
    context.document = { getElementById: () => null };
    const editor = Object.create(context.window.LevelEditor.prototype);
    Object.assign(editor, { level: context.level, game: { render() {} }, selectedPlatformIndex: 0 });
    const tile = context.level.platforms[0];
    for (const type of ['static', 'wall']) {
        tile.type = type;
        tile.tile = 'platform_tile';
        editor.assignTileToSelected('shield_tile');
        assert.equal(context.level.isShieldTile(tile), true);
    }
    for (const type of ['moving', 'anchor', 'climb']) {
        tile.type = type;
        tile.tile = 'platform_tile';
        editor.assignTileToSelected('shield_tile');
        assert.equal(tile.tile, 'platform_tile');
    }
    tile.type = 'wall';
    tile.material = 'solid';
    editor.assignTileToSelected('shield_tile');
    assert.equal(tile.tile, 'platform_tile');
    assert.equal(alerts.length, 4);
});
