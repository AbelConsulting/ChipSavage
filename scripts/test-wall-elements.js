const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup(platforms = []) {
    class Effect { update() {} }
    const context = vm.createContext({
        console,
        window: {},
        SpeedTrailEffect: Effect,
        HealthRegenEffect: Effect,
        DamageBoostEffect: Effect,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    for (const name of ['config', 'utils', 'levelData', 'level', 'player']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
    }
    context.platforms = platforms;
    vm.runInContext(`
        Player.prototype.loadSprites = function () { this.animations = {}; };
        globalThis.level = new Level(2000, 720);
        level.loadLevel({ platforms });
        globalThis.player = new Player(100, 436, null);
        player.level = level;
        globalThis.stage = LEVEL_CONFIGS[0];
    `, context);
    return context;
}

const elements = [
    ['vine', 'wall_tile_fire', 'fireball'],
    ['rock', 'wall_tile_bomb', 'bomb'],
    ['shock', 'wall_tile_shock', 'gold']
];

for (const [material, tile, correctShot] of elements) {
    for (const shot of ['gold', 'fireball', 'bomb', 'hookshot']) {
        test(`${tile} ${shot === correctShot ? 'accepts' : 'rejects'} ${shot}`, () => {
            for (const definition of [{ material }, { tile }, { tile, material: 'vine' }]) {
                const { level } = setup([{ x: 300, y: 200, width: 80, height: 480, type: 'wall', ...definition }]);
                const wall = level.platforms[0];
                const result = level.hitWall(wall, shot);
                const expectedMaterial = definition.tile ? material : definition.material;
                assert.equal(result.material, expectedMaterial);
                assert.equal(result.destroyed, shot === correctShot);
                assert.equal(level.platforms.includes(wall), shot !== correctShot);
            }
        });
    }

    test(`a real ${correctShot} projectile destroys a ${material} wall and invalidates cached art`, () => {
        const { level, player } = setup([
            { x: 300, y: 200, width: 80, height: 480, type: 'wall', material },
            { x: 258, y: 200, width: 36, height: 480, type: 'climb' }
        ]);
        level._staticNeedsUpdate = false;
        player.golfAmmo = 2;
        player.selectGolfShot(correctShot);
        player.shootGolfProjectile();
        for (let frame = 0; frame < 120 && player.golfProjectiles.length; frame++) {
            player.updateProjectiles(1 / 60, level);
        }
        assert.equal(level.platforms.length, 0);
        assert.equal(level._staticNeedsUpdate, true);
        assert.equal(player.golfAmmo, 1);
        assert.equal(player.golfProjectiles.length, 0);
        assert.equal(player.golfSprays[0].wallMaterial, material);
        if (material === 'shock') assert.equal(player.golfSprays[0].wallRingColor, '#FFD54A');
    });

    test(`${material} artwork matches its element in direct and scaled-cache rendering`, () => {
        const { level } = setup();
        const tiles = [];
        const scales = [];
        const labels = [];
        level._createPattern = (_, name) => { tiles.push(name); return {}; };
        const ctx = {
            save() {}, restore() {}, translate() {}, fillRect() {}, strokeRect() {},
            scale(x, y) { scales.push([x, y]); },
            fillText(text) { labels.push(text); }
        };
        const wall = { x: 300, y: 200, width: 80, height: 480, type: 'wall', material };
        level.drawPlatform(ctx, wall);
        level.drawDestructibleWall(ctx, { ...wall, x: 90, width: 24 }, 0.3, 1);
        assert.deepEqual(tiles, [tile, tile]);
        assert.deepEqual(scales, [[1, 1], [0.3, 1]]);
        assert.deepEqual(labels, []);
    });
}

test('plain and explicitly solid walls stay indestructible for every shot', () => {
    for (const tile of ['wall_tile', 'wall_tile_fire', 'wall_tile_bomb', 'wall_tile_shock']) {
        const { level } = setup([{ x: 300, y: 200, width: 80, height: 480, type: 'wall', material: 'solid', tile }]);
        for (const shot of ['gold', 'fireball', 'bomb', 'hookshot']) {
            assert.equal(level.hitWall(level.platforms[0], shot).destroyed, false);
        }
    }
});

test('the optional shock wall can be climbed without ammo', () => {
    const { level, player, stage } = setup();
    level.loadLevel(stage);
    const wall = level.platforms.find(p => p.material === 'shock' && p.x === 8460);
    player.x = wall.x - 42;
    player.y = 670 - player.height;
    player.golfAmmo = 0;
    player.keys = { arrowup: true };
    for (let frame = 0; frame < 45; frame++) player.update(1 / 60, level);
    assert.equal(player.y, wall.y - player.height);
    player.keys = { arrowright: true };
    for (let frame = 0; frame < 70; frame++) player.update(1 / 60, level);
    player.keys = {};
    for (let frame = 0; frame < 60; frame++) player.update(1 / 60, level);
    assert.ok(player.x > wall.x + wall.width);
    assert.equal(player.onGround, true);
    assert.equal(player.golfAmmo, 0);
    assert.ok(stage.skunkPowerups.some(p => p.x === 8270 && p.y === 390));
});

test('all elemental PNGs are preloaded and packaged byte-for-byte', () => {
    const root = path.join(__dirname, '..');
    const loader = fs.readFileSync(path.join(root, 'js', 'spriteLoader.js'), 'utf8');
    for (const [, tile] of elements) {
        assert.ok(loader.includes(`['${tile}', 'assets/sprites/backgrounds/tiles/${tile}.png']`));
        const asset = path.join('assets', 'sprites', 'backgrounds', 'tiles', `${tile}.png`);
        assert.deepEqual(fs.readFileSync(path.join(root, 'www', asset)), fs.readFileSync(path.join(root, asset)));
    }
    for (const file of ['level', 'levelData', 'player', 'spriteLoader', 'tutorialHints', 'levelEditor']) {
        assert.equal(
            fs.readFileSync(path.join(root, 'www', 'js', `${file}.js`), 'utf8'),
            fs.readFileSync(path.join(root, 'js', `${file}.js`), 'utf8')
        );
    }
});

test('editor elemental assignments update both visuals and shot bindings but protect solid blockers', () => {
    const context = setup([{ x: 300, y: 200, width: 80, height: 480, type: 'wall', material: 'vine' }]);
    const alerts = [];
    context.alert = message => alerts.push(message);
    context.document = { getElementById: () => null };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'levelEditor.js'), 'utf8'), context);
    const editor = Object.create(context.window.LevelEditor.prototype);
    editor.level = context.level;
    editor.game = { render() {} };
    editor.selectedPlatformIndex = 0;
    context.level._staticNeedsUpdate = false;
    editor.assignTileToSelected('wall_tile_bomb');
    assert.equal(context.level.getWallMaterial(context.level.platforms[0]), 'rock');
    assert.equal(context.level._staticNeedsUpdate, true);
    context.level.platforms[0].material = 'solid';
    editor.assignTileToSelected('wall_tile_shock');
    assert.equal(context.level.platforms[0].tile, 'wall_tile_bomb');
    assert.equal(context.level.getWallMaterial(context.level.platforms[0]), 'solid');
    context.level.platforms[0].type = 'static';
    editor.assignTileToSelected('wall_tile_fire');
    assert.equal(alerts.length, 2);
});
