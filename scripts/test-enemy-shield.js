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
    for (const name of ['config', 'utils', 'spriteLoader', 'enemy']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8'), context);
    }
    vm.runInContext(`
        Config.DEBUG = false;
        globalThis.enemy = new Enemy(100, 200, 'SECOND_BASIC');
        globalThis.config = Config;
    `, context);
    return context;
}

function canvas() {
    const arcs = [];
    const gradients = [];
    const strokes = [];
    let depth = 0;
    let lines = 0;
    const ctx = {
        globalAlpha: 1,
        save() { depth++; }, restore() { depth--; },
        beginPath() {}, closePath() {}, moveTo() {},
        lineTo() { lines++; }, clip() {}, fill() {},
        arc(...args) { arcs.push(args); },
        stroke() { strokes.push({ color: this.strokeStyle, alpha: this.globalAlpha }); },
        createRadialGradient() {
            const colors = [];
            gradients.push(colors);
            return { addColorStop(_, color) { colors.push(color); } };
        }
    };
    return { ctx, arcs, gradients, strokes, get depth() { return depth; }, get lines() { return lines; } };
}

test('active shield draws a blue honeycomb aura, orbit highlights, and twelve duration segments', () => {
    const { enemy, config } = setup();
    enemy.shieldActive = true;
    enemy.shieldTimer = config.SECOND_BASIC_SHIELD_DURATION;
    const output = canvas();
    enemy.drawShieldAura(output.ctx);
    assert.equal(output.gradients.length, 1);
    assert.equal(output.lines, 49 * 5);
    assert.equal(output.strokes.length, 17);
    assert.equal(output.strokes.filter(s => s.color === '#88D8FF').length, 12);
    assert.ok(output.gradients[0].some(color => color.startsWith('rgba(50, 145, 255')));
    assert.equal(output.depth, 0);
    assert.equal(enemy.shieldTimer, config.SECOND_BASIC_SHIELD_DURATION);
});

test('remaining shield time controls lit segments and a blocked hit produces an expanding ripple', () => {
    const { enemy, config } = setup();
    enemy.shieldActive = true;
    enemy.shieldTimer = config.SECOND_BASIC_SHIELD_DURATION / 2;
    const normal = canvas();
    enemy.drawShieldAura(normal.ctx);
    assert.equal(normal.strokes.filter(s => s.color === '#88D8FF').length, 6);
    enemy.shieldBreakFlash = 0.14;
    const hit = canvas();
    enemy.drawShieldAura(hit.ctx);
    assert.equal(hit.arcs.length, normal.arcs.length + 1);
    assert.equal(hit.depth, 0);
    assert.ok(hit.strokes.every(s => s.alpha >= 0 && s.alpha <= 1));
});

test('mobile flat rendering avoids all gradients and preserves shield and impact visuals', () => {
    const { enemy, config } = setup();
    config.MOBILE_FLAT_PARTICLES = true;
    enemy.shieldActive = true;
    enemy.shieldTimer = config.SECOND_BASIC_SHIELD_DURATION;
    enemy.takeDamage(10);
    const output = canvas();
    output.ctx.createRadialGradient = () => { throw new Error('Flat mode must not allocate gradients'); };
    enemy.drawShieldAura(output.ctx);
    assert.ok(output.arcs.length > 12);
    assert.equal(output.depth, 0);
});

test('inactive shields hide the membrane but allow hit particles to finish, and other enemies are unaffected', () => {
    const context = setup();
    const { enemy } = context;
    const hidden = canvas();
    enemy.drawShieldAura(hidden.ctx);
    assert.equal(hidden.arcs.length, 0);
    enemy.shieldParticles.push({ x: 120, y: 220, age: 0.1, life: 0.45, size: 5 });
    const fading = canvas();
    enemy.drawShieldAura(fading.ctx);
    assert.equal(fading.arcs.length, 1);
    assert.equal(fading.depth, 0);
    vm.runInContext("globalThis.basic = new Enemy(100, 200, 'BASIC');", context);
    context.basic.shieldActive = true;
    const basic = canvas();
    context.basic.drawShieldAura(basic.ctx);
    assert.equal(basic.arcs.length, 0);
});

test('shield visuals do not change damage absorption or particle lifetime', () => {
    const { enemy } = setup();
    const health = enemy.health;
    enemy.shieldActive = true;
    assert.equal(enemy.takeDamage(20), false);
    assert.equal(enemy.health, health);
    assert.equal(enemy.shieldBreakFlash, 0.28);
    assert.equal(enemy.shieldParticles.length, 10);
    enemy.drawShieldAura(canvas().ctx);
    assert.ok(enemy.shieldParticles.every(p => p.age === 0 && p.life === 0.45));
    enemy.shieldActive = false;
    enemy.takeDamage(5);
    assert.equal(enemy.health, health - 5);
});

test('packaged enemy renderer matches browser source', () => {
    const root = path.join(__dirname, '..');
    assert.equal(fs.readFileSync(path.join(root, 'www', 'js', 'enemy.js'), 'utf8'),
        fs.readFileSync(path.join(root, 'js', 'enemy.js'), 'utf8'));
});
