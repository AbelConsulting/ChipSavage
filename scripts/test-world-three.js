const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadStage, analyzeReachability } = require('./reachability.js');

const SHOTS = { rock: 'bomb', vine: 'fireball', shock: 'gold' };

function tick(level, player) {
    level.update(1 / 60);
    player.update(1 / 60, level);
}

for (const id of ['level_3', 'level_3_boss']) {
    test(`${id} exit, pickups and idol perches are reachable without golf ammo`, () => {
        const { level, stage, surfaces, reached } = analyzeReachability(id);
        const unreached = surfaces.filter(p => !reached.has(p) && p.type !== 'wall');
        assert.equal(unreached.map(p => `${p.type}@${p.x},${p.y}`).join(' '), '');

        const exitX = stage.completion.exitX;
        assert.ok([...reached].some(p => exitX >= p.x && exitX <= p.x + p.width), `exit ${exitX} unreachable`);

        for (const shield of level.platforms.filter(p => level.isShieldTile(p))) {
            const centerX = shield.x + shield.width / 2;
            const support = surfaces.find(p => Math.abs(p.y - (shield.y + 48 + 25)) < 2 &&
                centerX >= p.x && centerX <= p.x + p.width);
            assert.ok(support && reached.has(support), `${shield.powerupType} at ${shield.x},${shield.y} unreachable`);
        }

        for (const idol of stage.idols) {
            const perch = level.platforms.find(p => p.type === 'static' && p.height === 24 && p.y === idol.y + 40 &&
                idol.x - 15 >= p.x && idol.x + 15 <= p.x + p.width);
            assert.ok(perch && reached.has(perch), `idol ${idol.x},${idol.y} has no reachable perch`);
            assert.ok(perch.y <= 550);
            assert.equal(level.platforms.some(p => p.type === 'wall' && !level.isShieldTile(p) &&
                idol.x + 15 > p.x && idol.x - 15 < p.x + p.width && idol.y + 20 > p.y && idol.y - 20 < p.y + p.height), false);
        }
    });

    test(`${id} destructible gates keep a climbable bypass that survives the matching shot`, () => {
        const context = loadStage(id);
        const { level } = context;
        const gates = level.platforms.filter(p => p.type === 'wall' && SHOTS[p.material] && !level.isShieldTile(p));
        assert.ok(gates.length >= 2);
        for (const wall of gates) {
            const climb = level.platforms.find(p => p.type === 'climb' && p.y === wall.y &&
                p.height === wall.height && p.x + p.width <= wall.x && wall.x - p.x <= 60);
            assert.ok(climb, `${wall.material} wall ${wall.x} has no bypass`);

            const player = context.newPlayer();
            player.x = climb.x + (climb.width - player.width) / 2;
            player.y = wall.y + wall.height - player.height;
            player.keys = { arrowup: true };
            for (let frame = 0; frame < Math.ceil(wall.height / player.climbSpeed * 60) + 8; frame++) tick(level, player);
            assert.equal(player.y, wall.y - player.height);

            for (const wrong of ['gold', 'fireball', 'bomb', 'hookshot'].filter(s => s !== SHOTS[wall.material])) {
                assert.equal(level.hitWall(wall, wrong).destroyed, false);
            }
            assert.equal(level.hitWall(wall, SHOTS[wall.material]).destroyed, true);
            assert.ok(level.platforms.includes(climb), `climbable at ${climb.x} removed with its wall`);
        }
    });
}

test('Range Championship boss arena stays open', () => {
    const { stage, level } = loadStage('level_3_boss');
    assert.equal(stage.completion.bossTriggerX, 4440);
    assert.equal(stage.completion.exitX, 5280);
    assert.equal(stage.boss.spawnX, 4776);
    assert.equal(level.platforms.some(p => p.type === 'wall' && !level.isShieldTile(p) &&
        p.x + p.width > stage.completion.bossTriggerX), false);
    assert.ok(level.platforms.some(p => p.x === 0 && p.y === 650 && p.width === 5400));
});

for (const [id, startX, startY, anchorX, landingX] of [
    ['level_3', 11400, 520, 11712, 11940],
    ['level_3', 16300, 520, 16656, 16860],
    ['level_3_boss', 1700, 330, 2160, 2400]
]) {
    test(`${id} anchor ${anchorX} provides a complete swing and safe landing`, () => {
        const context = loadStage(id);
        const { level } = context;
        const player = context.newPlayer();
        player.x = startX;
        player.y = startY - player.height;
        player.onGround = true;
        player.golfAmmo = 1;
        player.keys = { arrowright: true };
        player.jump();
        for (let frame = 0; frame < 20; frame++) tick(level, player);
        const target = player.findHookshotTarget(level);
        assert.equal(target && target.x, anchorX);
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
            const distance = landing.x + 80 - player.x;
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
