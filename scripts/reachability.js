// Ammo-free reachability analysis for campaign stages, driven by the real Player/Level physics.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DT = 1 / 60;
const MAX_FRAMES = 150;
const SAMPLE_SPACING = 110;
const MOVING_PHASES = [0, 0.9, 1.8, 2.7];
const MOVING_PROXIMITY = 900;
const JUMP_PLANS = [[], [0], [0, 12], [0, 22], [0, 34]];

function loadStage(id) {
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
        globalThis.items = new ItemManager();
        globalThis.game = Object.create(Game.prototype);
        Object.assign(game, { level, itemManager: items, hitSparks: [] });
        globalThis.newPlayer = () => { const p = new Player(0, 0, null); p.level = level; return p; };
    `, context);
    return context;
}

const isSurface = (level, p) => !level.isShieldTile(p) && p.y >= 0 &&
    (p.type === 'static' || p.type === 'moving' || p.type === 'wall');

function standingOn(level, player) {
    if (!player.onGround) return null;
    if (player._groundPlatform) return player._groundPlatform;
    const feet = player.y + player.height;
    return level.platforms.find(p => p.type === 'wall' && isSurface(level, p) &&
        Math.abs(p.y - feet) < 1 && player.x + player.width > p.x && player.x < p.x + p.width) || null;
}

function setTime(level, time) {
    level._motionTime = time;
    level.update(0);
    for (const p of level.platforms) {
        p.previousX = p.x;
        p.previousY = p.y;
        p.dx = 0;
        p.dy = 0;
    }
}

function placeOn(context, surface, x) {
    const player = context.newPlayer();
    player.x = x;
    player.y = surface.y - player.height;
    player.onGround = true;
    player._groundPlatform = surface.type === 'wall' ? null : surface;
    player.golfAmmo = 0;
    player.keys = {};
    return player;
}

function run(context, player, { dir, jumps }, origin, visit) {
    const { level } = context;
    const deathY = (level.height || 720) + 120;
    player.keys = dir > 0 ? { arrowright: true } : dir < 0 ? { arrowleft: true } : {};
    for (let frame = 0; frame < MAX_FRAMES; frame++) {
        if (jumps.includes(frame)) player.jump();
        level.update(DT);
        player.update(DT, level);
        if (player.y > deathY) return;
        const surface = standingOn(level, player);
        if (surface && surface !== origin) visit(surface);
        if (frame > jumps[jumps.length - 1] + 2 && player.onGround && dir === 0) return;
    }
}

function climbTo(context, player, climbable) {
    const { level } = context;
    player.keys = { arrowup: true };
    const frames = Math.ceil(climbable.height / player.climbSpeed / DT) + 12;
    for (let frame = 0; frame < frames; frame++) {
        level.update(DT);
        player.update(DT, level);
        if (player.isClimbing && player.y <= climbable.y - player.height + 0.5) return true;
    }
    return false;
}

/**
 * Flood-fill the surfaces Chip can stand on from the stage start without golf ammo.
 * Walls stay intact, so a gate is only passable through its ladder/vine or a jump.
 */
function analyzeReachability(id, { startX = 100 } = {}) {
    const context = loadStage(id);
    const { level } = context;
    const surfaces = level.platforms.filter(p => isSurface(level, p));
    const climbables = level.platforms.filter(p => p.type === 'climb');
    const moving = surfaces.filter(p => p.type === 'moving');
    setTime(level, 0);
    const start = surfaces
        .filter(p => startX >= p.x && startX <= p.x + p.width)
        .sort((a, b) => b.y - a.y)[0];
    if (!start) throw new Error(`${id}: no surface under start x ${startX}`);

    const reached = new Set([start]);
    const queue = [start];
    const visit = surface => {
        if (!reached.has(surface)) {
            reached.add(surface);
            queue.push(surface);
        }
    };
    const plans = [];
    for (const dir of [-1, 0, 1]) for (const jumps of JUMP_PLANS) plans.push({ dir, jumps });

    while (queue.length) {
        const surface = queue.shift();
        const nearMoving = moving.some(p => Math.abs(p.initialX - surface.initialX) < MOVING_PROXIMITY + surface.width);
        const phases = surface.type === 'moving' || nearMoving ? MOVING_PHASES : [0];
        for (const time of phases) {
            setTime(level, time);
            const span = Math.max(0, surface.width - 64);
            const count = Math.max(1, Math.ceil(span / SAMPLE_SPACING));
            const offsets = new Set([0, span]);
            for (let i = 1; i < count; i++) offsets.add(Math.round(span * i / count));
            for (const offset of offsets) {
                for (const plan of plans) {
                    setTime(level, time);
                    run(context, placeOn(context, surface, surface.x + offset), plan, surface, visit);
                }
            }
            for (const climbable of climbables) {
                setTime(level, time);
                const centerX = climbable.x + climbable.width / 2;
                const feetOnLadder = surface.y > climbable.y && surface.y <= climbable.y + climbable.height + 4;
                if (!feetOnLadder || centerX < surface.x || centerX > surface.x + surface.width) continue;
                for (const plan of plans) {
                    setTime(level, time);
                    const player = placeOn(context, surface, climbable.x + (climbable.width - 64) / 2);
                    if (!climbTo(context, player, climbable)) continue;
                    run(context, player, plan, null, visit);
                }
            }
        }
    }
    return { context, level, stage: context.stage, surfaces, reached, start };
}

module.exports = { loadStage, analyzeReachability, isSurface };
