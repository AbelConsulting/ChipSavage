const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadPlayer() {
    const context = vm.createContext({ console, Config: { GRAVITY: 1800 }, __err() {} });
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'player.js'), 'utf8');
    vm.runInContext(source + '\nglobalThis.Player = Player;', context);
    return context.Player;
}

function makePlayer(Player) {
    const player = Object.create(Player.prototype);
    Object.assign(player, {
        x: 100,
        y: 400,
        width: 64,
        height: 64,
        facingRight: true,
        isClimbing: false,
        golfAmmo: 2,
        golfCooldownTimer: 0,
        golfCooldown: 0.5,
        hitStunTimer: 0,
        selectedGolfShotIndex: 0,
        availableGolfShotTypes: ['hookshot'],
        golfProjectiles: [],
        golfSprays: [],
        golfShotDuration: 0.32,
        animations: {},
        audioManager: null
    });
    return player;
}

test('hookshot targets the nearest forward anchor and travels toward it', () => {
    const Player = loadPlayer();
    const player = makePlayer(Player);
    const behind = { x: 0, y: 300, width: 48, height: 48, type: 'anchor' };
    const target = { x: 420, y: 160, width: 48, height: 48, type: 'anchor' };
    player.level = { platforms: [behind, target] };

    player.shootGolfProjectile();

    assert.equal(player.golfProjectiles.length, 1);
    const projectile = player.golfProjectiles[0];
    assert.equal(projectile.shotType, 'hookshot');
    assert.equal(projectile.targetAnchor, target);
    assert.ok(projectile.velocityX > 0);
    assert.ok(projectile.velocityY < 0);
    assert.equal(player.golfAmmo, 1);
});

test('hookshot does not consume ammo when no anchor is in range', () => {
    const Player = loadPlayer();
    const player = makePlayer(Player);
    player.level = { platforms: [{ x: 1200, y: 100, width: 48, height: 48, type: 'anchor' }] };

    player.shootGolfProjectile();

    assert.equal(player.golfProjectiles.length, 0);
    assert.equal(player.golfAmmo, 2);
});

test('hookshot renderer draws a cable and hook head instead of a ball', () => {
    const Player = loadPlayer();
    const player = makePlayer(Player);
    player.golfProjectiles.push({
        x: 280,
        y: 220,
        width: 20,
        velocityX: 700,
        velocityY: -400,
        facingRight: true,
        shotType: 'hookshot'
    });
    const calls = { lineTo: 0, arc: 0, stroke: 0 };
    const ctx = {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, translate() {}, rotate() {}, setLineDash() {},
        lineTo() { calls.lineTo++; },
        arc() { calls.arc++; },
        stroke() { calls.stroke++; }
    };

    player.drawProjectiles(ctx, 0, 0);

    assert.ok(calls.lineTo >= 4);
    assert.ok(calls.stroke >= 3);
    assert.equal(calls.arc, 0);
});

function loadLevels() {
    class Effect { update() {} }
    const context = vm.createContext({
        console,
        SpeedTrailEffect: Effect,
        HealthRegenEffect: Effect,
        DamageBoostEffect: Effect,
        __err(...args) { throw new Error(args.join(' ')); }
    });
    for (const name of ['config', 'utils', 'levelData', 'level', 'player']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
    }
    vm.runInContext(`
        Player.prototype.loadSprites = function () { this.animations = {}; };
        globalThis.levels = [...LEVEL_CONFIGS, SURVIVAL_ARENA_CONFIG];
        globalThis.LevelClass = Level;
        globalThis.PlayerClass = Player;
    `, context);
    return context;
}

const allLevels = loadLevels();
for (const stage of allLevels.levels) {
    for (const definition of stage.platforms.filter(p => p.type === 'anchor')) {
        test(`${stage.id} anchor ${definition.x} is high, clear and reachable by a real hook`, () => {
            assert.ok(definition.y >= 64 && definition.y <= 150);
            const candidates = stage.platforms.filter(p =>
                (p.type === 'static' || p.type === 'moving') &&
                p.y >= definition.y + definition.height + 48 &&
                p.x < definition.x + 600 && p.x + p.width > definition.x - 600
            );
            let attached = false;
            for (const support of candidates) {
                for (const side of [-1, 1]) {
                    const level = new allLevels.LevelClass();
                    level.loadLevel(stage);
                    const anchor = level.platforms.find(p => p.type === 'anchor' && p.x === definition.x);
                    assert.equal(level.getWallAt(anchor), null, 'Anchor must not be buried in a wall');
                    const x = Math.max(support.x, Math.min(support.x + support.width - 64, anchor.x + side * 180));
                    const player = new allLevels.PlayerClass(x, support.y - 64, null);
                    player.level = level;
                    player.onGround = true;
                    player.facingRight = x + player.width / 2 <= anchor.x + anchor.width / 2;
                    player.golfAmmo = 1;
                    player.selectGolfShot('hookshot');
                    player.jump();
                    for (let frame = 0; frame < 20; frame++) {
                        level.update(1 / 60);
                        player.update(1 / 60, level);
                    }
                    if (player.findHookshotTarget(level) !== anchor) continue;
                    player.shootGolfProjectile();
                    for (let frame = 0; frame < 90 && player.golfProjectiles.length; frame++) {
                        level.update(1 / 60);
                        player.update(1 / 60, level);
                        if (player.hookshotSwing) {
                            attached = true;
                            assert.equal(player.hookshotSwing.y, anchor.y + anchor.height / 2);
                            assert.equal(player.golfAmmo, 0);
                            break;
                        }
                    }
                    if (attached) break;
                }
                if (attached) break;
            }
            assert.ok(attached, 'At least one nearby platform must provide a working launch');
        });
    }
}
