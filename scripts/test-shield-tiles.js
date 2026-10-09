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
    test(`a real ${action} breaks and collects each first-level shield from the ground`, () => {
        const { player, level, game, items, stage } = setup();
        for (const definition of stage.platforms.filter(p => p.tile === 'shield_tile')) {
            level.loadLevel(stage);
            items.items.length = 0;
            player.x = definition.x - player.width;
            player.y = definition.y + definition.height - player.height;
            player.velocityX = 0;
            player.velocityY = 0;
            player.onGround = true;
            player.facingRight = true;
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

test('first-level shields sit on reachable ground and sprite is preloaded and packaged', () => {
    const { stage, level } = setup();
    const shields = stage.platforms.filter(tile => level.isShieldTile(tile));
    assert.equal(shields.length, 3);
    for (const tile of shields) {
        assert.ok(stage.platforms.some(p => p.type === 'static' &&
            p.y === tile.y + tile.height && p.x <= tile.x && p.x + p.width >= tile.x + tile.width));
    }
    const loader = fs.readFileSync(path.join(root, 'js', 'spriteLoader.js'), 'utf8');
    assert.ok(loader.includes("['shield_tile', 'assets/sprites/backgrounds/tiles/shield_tile.png']"));
    const asset = path.join('assets', 'sprites', 'backgrounds', 'tiles', 'shield_tile.png');
    assert.deepEqual(fs.readFileSync(path.join(root, asset)), fs.readFileSync(path.join(root, 'www', asset)));
    for (const name of ['game', 'level', 'levelData', 'player', 'itemManager', 'spriteLoader', 'levelEditor', 'tutorialHints']) {
        assert.equal(fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'),
            fs.readFileSync(path.join(root, 'www', 'js', `${name}.js`), 'utf8'));
    }
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
