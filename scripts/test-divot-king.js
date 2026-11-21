const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
    const root = path.join(__dirname, '..');
    const context = vm.createContext({ console, __err(...args) { throw new Error(args.join(' ')); } });
    for (const name of ['config', 'utils', 'spriteLoader', 'levelData', 'enemy', 'enemyManager']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'), context);
    }
    vm.runInContext(`
        globalThis.stage = LEVEL_CONFIGS.find(stage => stage.id === 'level_10_boss');
        globalThis.manager = new EnemyManager();
        globalThis.boss = manager.spawnBoss(stage.boss);
        globalThis.baseHealth = Config.ENEMY_HEALTH;
        globalThis.first = LEVEL_CONFIGS.find(stage => stage.id === 'level_1_boss');
    `, context);
    const level = {
        width: 5000,
        height: 720,
        checkPlatformCollision(rect) {
            return rect.y + rect.height >= 580
                ? { collided: true, landingY: 580 - rect.height }
                : { collided: false };
        }
    };
    const player = {
        x: 4200, y: 516, width: 64, height: 64,
        getRect() { return { x: this.x, y: this.y, width: this.width, height: this.height }; },
        takeDamage() { return true; }
    };
    context.boss.y = 452;
    return { ...context, level, player };
}

function advanceUntil(boss, player, level, phase, limit = 15) {
    for (let t = 0; t < limit; t += 0.02) {
        boss.update(0.02, player, level);
        if (boss.divotPhase === phase) return;
    }
    assert.fail(`did not reach ${phase}; current phase ${boss.divotPhase}`);
}

test('final stage spawns a distinct boss without changing the first Greenskeeper', () => {
    const { boss, stage, baseHealth, first } = setup();
    assert.equal(stage.boss.type, 'BOSS10');
    assert.equal(boss.bossName, 'THE DIVOT KING');
    assert.equal(boss.isBossType(), true);
    assert.equal(boss.maxHealth, Math.floor(baseHealth * stage.boss.healthMultiplier));
    assert.equal(first.boss.bossName, 'THE GREENSKEEPER');
});

test('burrow telegraphs a moving, low hitbox and leaves a damageable recovery', () => {
    const { boss, player, level, manager } = setup();
    advanceUntil(boss, player, level, 'burrow_windup');
    assert.equal(boss.isAttackDamageActive(), false);
    const startX = boss.x;
    advanceUntil(boss, player, level, 'burrow');
    boss.update(0.1, player, level);
    assert.ok(boss.x < startX);
    assert.equal(boss.isAttackDamageActive(), true);
    player.x = boss.x + 30;
    assert.equal(manager.checkEnemyAttacks(player).hit, true);
    player.y = boss.y;
    assert.equal(manager.checkEnemyAttacks(player).hit, false);
    advanceUntil(boss, player, level, 'recovery');
    assert.equal(boss.isAttackDamageActive(), false);
    const hp = boss.health;
    boss.takeDamage(10, 1, { knockback: 0, hitStun: 0 });
    assert.equal(boss.health, hp - 10);
});

test('barrage follows a tell, creates arcing projectiles, and sweep has a recovery', () => {
    const { boss, player, level } = setup();
    advanceUntil(boss, player, level, 'barrage_windup');
    assert.equal(boss.thrownProjectiles.length, 0);
    advanceUntil(boss, player, level, 'recovery');
    assert.equal(boss.thrownProjectiles.length, 3);
    const projectile = boss.thrownProjectiles[0];
    const initialVy = projectile.velocityY;
    boss.update(0.1, player, level);
    assert.ok(projectile.velocityY > initialVy);
    advanceUntil(boss, player, level, 'sweep_windup');
    assert.equal(boss.isAttackDamageActive(), false);
    advanceUntil(boss, player, level, 'sweep');
    assert.equal(boss.isAttackDamageActive(), true);
    assert.equal(boss.attackHitbox.height, 42);
    advanceUntil(boss, player, level, 'recovery');
    assert.equal(boss.isAttackDamageActive(), false);
});

test('enraged burrow leads to a faster sweep and a longer recovery', () => {
    const { boss, player, level } = setup();
    boss.health = boss.maxHealth * 0.5;
    advanceUntil(boss, player, level, 'emerge');
    assert.equal(boss.bossEnraged, true);
    advanceUntil(boss, player, level, 'sweep_windup');
    advanceUntil(boss, player, level, 'sweep');
    assert.ok(boss.divotTimer <= 0.22);
    advanceUntil(boss, player, level, 'recovery');
    assert.ok(boss.divotTimer >= 1.7);
    boss.hitStunTimer = 0.4;
    boss.divotPhase = 'sweep';
    boss.divotTimer = 0.2;
    boss.update(0.02, player, level);
    assert.equal(boss.isAttackDamageActive(), false);
    assert.equal(boss.divotTimer, 0.2);
});

test('the boss remains bounded and is removed by the normal defeat pipeline', () => {
    const { boss, player, level, manager } = setup();
    boss.bossEntranceDone = true;
    boss.x = level.width - boss.width;
    boss.divotDirection = 1;
    boss.divotPhase = 'burrow';
    boss.divotTimer = 1;
    boss.update(0.1, player, level);
    assert.equal(boss.x, level.width - boss.width);
    assert.equal(manager.getBoss(), boss);
    boss.takeDamage(boss.health, 1, { knockback: 0, hitStun: 0 });
    manager.spawningEnabled = false;
    manager.update(0.02, player, level);
    assert.equal(manager.getBoss(), null);
    assert.equal(manager.enemiesDefeated, 1);
});
