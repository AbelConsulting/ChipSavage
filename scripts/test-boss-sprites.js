const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
    const context = vm.createContext({
        console,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    for (const name of ['config', 'utils', 'spriteLoader', 'levelData', 'enemy', 'enemyManager']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
    }
    vm.runInContext(`
        globalThis.loader = spriteLoader;
        for (const prefix of ['boss', 'boss1', 'basic']) {
            for (const state of ['idle', 'walk', 'attack', 'attack1', 'hurt']) {
                spriteLoader.sprites[prefix + '_' + state] = { width: 512, height: 128 };
            }
        }
        spriteLoader._ready = true;
        globalThis.stage = LEVEL_CONFIGS.find(s => s.id === 'level_2_boss');
        globalThis.manager = new EnemyManager();
        globalThis.boss = manager.spawnBoss(stage.boss, stage);
    `, context);
    return context;
}

test('Municipal boss uses boss1 sheets for all four animations without changing combat', () => {
    const { boss, manager, stage, loader } = setup();
    assert.equal(stage.boss.spritePrefix, 'boss1');
    assert.equal(boss.enemyType, 'BOSS');
    assert.equal(boss.width, 128);
    assert.equal(boss.height, 128);
    for (const state of ['idle', 'walk', 'attack', 'hurt']) {
        assert.equal(boss.animations[state].spriteSheet, loader.getSprite(`boss1_${state}`));
        assert.equal(boss.animations[state].frameCount, 4);
    }
    const context = setup();
    vm.runInContext(`
        globalThis.original = new EnemyManager().spawnBoss({ ...stage.boss, spritePrefix: undefined }, stage);
    `, context);
    for (const key of ['enemyType', 'health', 'maxHealth', 'speed', 'attackDamage', 'attackRange', 'attackWindup', 'attackCooldown', 'x', 'y']) {
        assert.equal(boss[key], context.original[key], key);
    }
    assert.equal(manager.spawnBoss(stage.boss, stage), boss);
    assert.equal(manager.enemies.length, 1);
});

test('first boss and default enemies retain their original artwork', () => {
    const context = setup();
    vm.runInContext(`
        globalThis.first = new EnemyManager().spawnBoss(LEVEL_CONFIGS.find(s => s.id === 'level_1_boss').boss);
        globalThis.basic = new Enemy(0, 0);
    `, context);
    assert.equal(context.first.animations.idle.spriteSheet, context.loader.getSprite('boss_idle'));
    assert.equal(context.first.animations.attack.spriteSheet, context.loader.getSprite('boss_attack1'));
    assert.equal(context.basic.animations.idle.spriteSheet, context.loader.getSprite('basic_idle'));
    context.boss.loadSprites();
    assert.equal(context.boss.animations.attack.spriteSheet, context.loader.getSprite('boss1_attack'));
});

test('boss1 preload names, frame counts and packaged assets match the new artwork', async () => {
    const { loader: spriteLoader } = setup();
    const loaded = new Map();
    spriteLoader.loadSprite = async (name, assetPath) => { loaded.set(name, assetPath.split('?')[0]); };
    await spriteLoader.loadAllSprites();
    for (const state of ['idle', 'walk', 'attack', 'hurt']) {
        const key = `boss1_${state}`;
        const relative = `assets/sprites/enemies/${key}.png`;
        assert.equal(loaded.get(key), relative);
        assert.equal(spriteLoader.expectedFrames[key], 4);
        const animation = spriteLoader.createAnimation(key, 4);
        assert.equal(animation.frameWidth, 128);
        assert.equal(animation.frameStride, 128);
        assert.equal(animation.frameOffset, 0);
        const bytes = fs.readFileSync(path.join(__dirname, '..', relative));
        assert.equal(bytes.readUInt32BE(16), 512);
        assert.equal(bytes.readUInt32BE(20), 128);
        assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', 'www', relative)), bytes);
    }
    for (const name of ['enemy', 'enemyManager', 'spriteLoader', 'levelData']) {
        assert.equal(
            fs.readFileSync(path.join(__dirname, '..', 'www', 'js', `${name}.js`), 'utf8'),
            fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')
        );
    }
});
