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
    const events = [];
    app._sendKeyEvent = (key, type) => events.push({ key, type });
    return { app, gamepad, buttons, events, context };
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

for (const [label, index, key] of [
    ['A', 0, ' '],
    ['B', 1, 'c'],
    ['X', 2, 'x'],
    ['Y', 3, 'x'],
    ['RB', 5, 'v'],
    ['LT', 6, 'c'],
    ['RT', 7, 'x'],
    ['LB', 4, 'Escape'],
    ['Start', 9, 'Escape']
]) {
    test(`Xbox ${label} presses and releases only its mapped gameplay action`, () => {
        const { app, gamepad, buttons, events } = setup();
        gamepad.id = 'Xbox Wireless Controller';

        buttons[index].pressed = true;
        app._handleGamepadInput();
        for (const action of [' ', 'x', 'c', 'z', 'v', 'Escape']) {
            assert.equal(!!app._gamepadKeys[action], action === key, action);
        }
        assert.equal(events.filter(event => event.key === key && event.type === 'keydown').length, 1);

        app._handleGamepadInput();
        assert.equal(events.filter(event => event.key === key && event.type === 'keydown').length, 1);

        buttons[index].pressed = false;
        app._handleGamepadInput();
        assert.equal(app._gamepadKeys[key], false);
        assert.equal(events.filter(event => event.key === key && event.type === 'keyup').length, 1);
    });
}

test('Select/View has no gameplay action and still confirms in menus', () => {
    const { app, buttons } = setup();

    buttons[8].pressed = true;
    app._handleGamepadInput();
    assert.equal(!!app._gamepadKeys.v, false);
    assert.equal(!!app._gamepadKeys.Enter, false);

    app.game.state = 'MENU';
    app._handleGamepadInput();
    assert.equal(!!app._gamepadKeys.v, false);
    assert.equal(app._gamepadKeys.Enter, true);

    buttons[8].pressed = false;
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.Enter, false);
});

test('RB cycles shots once per press, only during play, including analog button values', () => {
    const { app, buttons, events } = setup();

    buttons[5].value = 1;
    app._handleGamepadInput();
    app._handleGamepadInput();
    assert.equal(events.filter(event => event.key === 'v' && event.type === 'keydown').length, 1);

    app.game.state = 'PAUSED';
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.v, false);
    assert.equal(!!app._gamepadKeys.Enter, false);

    buttons[5].value = 0;
    app._handleGamepadInput();
    app.game.state = 'PLAYING';
    buttons[5].value = 1;
    app._handleGamepadInput();
    assert.equal(events.filter(event => event.key === 'v' && event.type === 'keydown').length, 2);
});

test('X and Y share attack without releasing it while either button is held', () => {
    const { app, buttons, events } = setup();

    buttons[2].pressed = true;
    app._handleGamepadInput();
    buttons[3].pressed = true;
    app._handleGamepadInput();
    buttons[2].pressed = false;
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.x, true);
    assert.equal(events.filter(event => event.key === 'x').length, 1);

    buttons[3].pressed = false;
    app._handleGamepadInput();
    assert.equal(app._gamepadKeys.x, false);
    assert.equal(events.filter(event => event.key === 'x' && event.type === 'keyup').length, 1);
});

for (const index of [0, 1, 2, 3, 7]) {
    test(`standard button ${index} still confirms menus once per press`, () => {
        const { app, buttons, events } = setup();
        let starts = 0;
        app.game = { state: 'MENU', startGame: () => { starts++; } };

        buttons[index].pressed = true;
        app._handleGamepadInput();
        app._handleGamepadInput();
        assert.equal(starts, 1);
        assert.equal(events.filter(event => event.key === 'Enter' && event.type === 'keydown').length, 1);

        buttons[index].pressed = false;
        app._handleGamepadInput();
        assert.equal(events.filter(event => event.key === 'Enter' && event.type === 'keyup').length, 1);
    });
}

test('XR right-controller jump, special attack, grip shot and trigger attack are unchanged', () => {
    const { app, gamepad, buttons } = setup();
    gamepad.id = 'Oculus Touch (Right)';
    gamepad.mapping = 'xr-standard';
    gamepad.hand = 'right';

    for (const [index, key] of [[3, ' '], [2, 'z'], [1, 'c'], [0, 'x']]) {
        buttons[index].pressed = true;
        app._handleGamepadInput();
        assert.equal(app._gamepadKeys[key], true);
        assert.equal(!!app._gamepadKeys.v, false);
        buttons[index].pressed = false;
        app._handleGamepadInput();
        assert.equal(app._gamepadKeys[key], false);
    }
});

test('mapped controller inputs invoke the intended player actions', () => {
    const { app, buttons, context } = setup();
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'player.js'), 'utf8');
    vm.runInContext(source + '\nglobalThis.Player = Player;', context);
    const player = Object.create(context.Player.prototype);
    player.keys = {};
    player.jumpBufferTimer = 0;
    player.jumpBufferTime = 0.15;
    player.jumpBufferCount = 0;
    player.maxJumps = 2;
    const actions = [];
    player.attack = () => actions.push('attack');
    player.specialAttack = () => actions.push('special');
    player.shootGolfProjectile = () => actions.push('golf');
    player.cycleGolfShot = () => actions.push('cycle');
    app._sendKeyEvent = (key, type) => player.handleInput(key, type === 'keydown');

    for (const index of [0, 1, 2, 3, 5, 8]) {
        buttons[index].pressed = true;
        app._handleGamepadInput();
        app._handleGamepadInput();
        buttons[index].pressed = false;
        app._handleGamepadInput();
    }
    assert.equal(player.jumpBufferTimer, player.jumpBufferTime);
    assert.equal(player.jumpBufferCount, 1);
    assert.deepEqual(actions, ['golf', 'attack', 'attack', 'cycle']);
});

test('packaged gamepad mapping matches the browser source', () => {
    const root = path.join(__dirname, '..');
    assert.equal(
        fs.readFileSync(path.join(root, 'www', 'js', 'main.js'), 'utf8'),
        fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8')
    );
});