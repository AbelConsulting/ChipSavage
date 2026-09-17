const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
    const gamepad = { id: 'Standard Gamepad', mapping: 'standard', axes: [0, 0, 0, 0], buttons };
    const window = new EventTarget();
    const document = new EventTarget();
    document.getElementById = () => null;
    const context = vm.createContext({
        window,
        document,
        navigator: { getGamepads: () => [gamepad] },
        console,
        KeyboardEvent: class extends Event {
            constructor(type, options) {
                super(type);
                Object.assign(this, options);
            }
        },
        __err() {}
    });
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    vm.runInContext(source + '\nglobalThis.GameApp = GameApp;', context);

    const app = Object.create(context.GameApp.prototype);
    app.game = { state: 'PLAYING' };
    app._gamepadKeys = {};
    app._disableTouchControlsForVr = () => {};
    app._sendKeyEvent = () => {};
    return { app, gamepad, buttons };
}

test('standard gamepad maps vertical stick and D-pad input', () => {
    const { app, gamepad, buttons } = setup();

    gamepad.axes[1] = -0.8;
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.ArrowUp, true);
    assert.equal(!!app._gamepadKeys.ArrowDown, false);

    gamepad.axes[1] = 0;
    buttons[13].pressed = true;
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.ArrowUp, false);
    assert.equal(app._gamepadKeys.ArrowDown, true);
});

test('Select/View cycles shots during play and confirms in menus', () => {
    const { app, buttons } = setup();

    buttons[8].pressed = true;
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.v, true);
    assert.equal(!!app._gamepadKeys.Enter, false);

    app.game.state = 'MENU';
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.v, false);
    assert.equal(app._gamepadKeys.Enter, true);
});