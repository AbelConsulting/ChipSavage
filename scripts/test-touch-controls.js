const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

class Control extends EventTarget {
    constructor() {
        super();
        this.classes = new Set();
        this.captures = new Set();
        this.classList = {
            add: value => this.classes.add(value),
            remove: value => this.classes.delete(value),
            contains: value => this.classes.has(value)
        };
        this.style = { setProperty() {}, removeProperty() {} };
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 112, height: 112 }; }
    setPointerCapture(pointer) { this.captures.add(pointer); }
    hasPointerCapture(pointer) { return this.captures.has(pointer); }
    releasePointerCapture(pointer) { this.captures.delete(pointer); }
}

function setup() {
    const controls = Object.fromEntries(['move-stick', 'btn-jump', 'btn-attack', 'btn-special', 'btn-skunk']
        .map(id => [id, new Control()]));
    const window = new EventTarget();
    const document = new EventTarget();
    document.getElementById = id => controls[id];
    const keys = new Set();
    const game = { state: 'PLAYING', _clearAllInput: () => keys.clear() };
    window.game = game;
    const context = vm.createContext({
        window, document, game, navigator: {}, isMobile: () => true,
        triggerKeyEvent: (key, type) => type === 'keydown' ? keys.add(key) : keys.delete(key)
    });
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const start = html.indexOf('    function initTouchControls()');
    const end = html.indexOf('    function initShotAbilityTray()', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(html.slice(start, end) + '\ninitTouchControls();', context);
    const send = (id, type, values = {}) => {
        const event = new Event(type, { cancelable: true });
        Object.assign(event, { pointerId: 1, clientX: 56, clientY: 56, ...values });
        controls[id].dispatchEvent(event);
    };
    return { controls, window, document, keys, game, send };
}

test('thumb pad changes direction, supports diagonals, and has a neutral center', () => {
    const { send, keys } = setup();
    send('move-stick', 'pointerdown', { clientX: 100 });
    assert.deepEqual([...keys], ['ArrowRight']);
    send('move-stick', 'pointermove', { clientX: 10, clientY: 10 });
    assert.deepEqual([...keys].sort(), ['ArrowLeft', 'ArrowUp']);
    send('move-stick', 'pointermove', { clientY: 100 });
    assert.deepEqual([...keys], ['ArrowDown']);
    send('move-stick', 'pointermove');
    assert.equal(keys.size, 0);
});

test('another finger can attack without stealing the movement pointer', () => {
    const { send, keys } = setup();
    send('move-stick', 'pointerdown', { clientX: 100 });
    send('move-stick', 'pointerdown', { pointerId: 2, clientX: 10 });
    send('btn-attack', 'pointerdown', { pointerId: 2 });
    assert.deepEqual([...keys].sort(), ['ArrowRight', 'x']);
    send('btn-attack', 'pointerup', { pointerId: 3 });
    assert.ok(keys.has('x'));
    send('btn-attack', 'pointerup', { pointerId: 2 });
    assert.deepEqual([...keys], ['ArrowRight']);
    send('move-stick', 'pointerup');
    assert.equal(keys.size, 0);
});

test('cancellation and lost pointer capture release controls', () => {
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        const { send, keys, controls } = setup();
        send('move-stick', 'pointerdown', { clientX: 100 });
        send('btn-jump', 'pointerdown', { pointerId: 2 });
        send('move-stick', type);
        send('btn-jump', type, { pointerId: 2 });
        assert.equal(keys.size, 0);
        assert.equal(controls['move-stick'].classes.size, 0);
        assert.equal(controls['btn-jump'].classes.size, 0);
    }
});

test('pause, blur, and backgrounding clear input and reset the pad', () => {
    for (const reason of ['pause', 'blur', 'hidden']) {
        const { send, keys, controls, game, window, document } = setup();
        send('move-stick', 'pointerdown', { clientX: 100 });
        send('btn-skunk', 'pointerdown', { pointerId: 2 });
        if (reason === 'pause') {
            game.state = 'PAUSED';
            const event = new Event('gameStateChange');
            event.detail = { state: 'PAUSED' };
            window.dispatchEvent(event);
        } else if (reason === 'blur') {
            window.dispatchEvent(new Event('blur'));
        } else {
            document.hidden = true;
            document.dispatchEvent(new Event('visibilitychange'));
        }
        assert.equal(keys.size, 0);
        assert.equal(controls['move-stick'].captures.size, 0);
        assert.equal(controls['btn-skunk'].captures.size, 0);
    }
});

test('controls ignore presses outside gameplay and disabled fire presses', () => {
    const { send, keys, controls, game } = setup();
    game.state = 'PAUSED';
    send('move-stick', 'pointerdown', { clientX: 100 });
    send('btn-attack', 'pointerdown', { pointerId: 2 });
    assert.equal(keys.size, 0);
    game.state = 'PLAYING';
    controls['btn-skunk'].classes.add('disabled');
    send('btn-skunk', 'pointerdown');
    assert.equal(keys.size, 0);
});