const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadScript(context, file) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    vm.runInContext(source, context);
}

function createContext(values = {}, platform = 'web') {
    const storage = new Map(Object.entries(values));
    const context = vm.createContext({
        PLATFORM: platform,
        console: { log() {}, warn() {} },
        addEventListener() {},
        document: { readyState: 'loading', addEventListener() {} },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        setTimeout: () => 1,
        clearTimeout() {}
    });
    context.window = context;
    return context;
}

test('free and legacy founder saves do not unlock cosmetic skins', () => {
    for (const values of [{}, {
        'chipsavage.founder': '1',
        'chipsavage.founderPassOwned': '1',
        'chipsavage.useGoldSkin': '1',
        'chipsavage.skinVariant': 'gold'
    }]) {
        const context = createContext(values);
        loadScript(context, 'skinManager.js');
        const manager = context.SkinManager;
        manager.initialize();
        assert.equal(manager.hasAnyUnlockedSkin(), false);
        assert.equal(manager.isGoldSkinEnabled(), false);
        assert.equal(manager.setSkinVariant('gold'), false);
        assert.equal(manager.setSkinVariant('steel'), false);
        assert.equal(context.FounderManager, undefined);
    }
});

test('Remove Ads and Steam retain three skins and saved preferences', () => {
    for (const platform of ['web', 'steam']) {
        const context = createContext({
            'chipsavage.adFree': platform === 'web' ? '1' : '0',
            'chipsavage.useGoldSkin': '1',
            'chipsavage.skinVariant': 'steel'
        }, platform);
        loadScript(context, 'skinManager.js');
        const manager = context.SkinManager;
        assert.deepEqual(Array.from(manager.getUnlockedSkinVariants()), ['sapphire', 'amethyst', 'steel']);
        assert.equal(manager.getSkinVariant(), 'steel');
        assert.equal(manager.isGoldSkinEnabled(), true);
        assert.equal(manager.isSkinUnlocked('gold'), false);
        assert.equal(manager.setSkinVariant('amethyst'), true);
        assert.equal(context.localStorage.getItem('chipsavage.skinVariant'), 'amethyst');
        manager.setGoldSkinEnabled(false);
        assert.equal(manager.isGoldSkinEnabled(), false);
    }
});

test('Remove Ads registers, purchases, restores, and notifies skin listeners', async () => {
    const context = createContext();
    const handlers = {};
    const registrations = [];
    let owned = false;
    let orderCount = 0;
    let finishCount = 0;
    const product = {
        id: 'remove_ads', pricing: { price: '$1.99' },
        getOffer: () => ({ order: async () => { orderCount++; } })
    };
    const chain = {};
    for (const event of ['productUpdated', 'approved', 'verified', 'finished', 'receiptUpdated']) {
        chain[event] = handler => { handlers[event] = handler; return chain; };
    }
    context.Capacitor = { isNativePlatform: () => true };
    context.CdvPurchase = {
        ProductType: { NON_CONSUMABLE: 'non-consumable' },
        Platform: { GOOGLE_PLAY: 'google-play' },
        LogLevel: { DEBUG: 4 },
        store: {
            register: products => registrations.push(...products),
            when: () => chain,
            initialize: async () => { handlers.productUpdated(product); },
            owned: id => id === 'remove_ads' && owned,
            get: id => id === 'remove_ads' ? product : null,
            restorePurchases: async () => { handlers.receiptUpdated({}); }
        }
    };
    loadScript(context, 'purchaseManager.js');
    loadScript(context, 'skinManager.js');
    context.SkinManager.initialize();
    let changes = 0;
    const unsubscribe = context.SkinManager.onChange(() => changes++);
    const manager = context.PurchaseManager;
    await manager.initialize();
    changes = 0;
    assert.deepEqual(registrations.map(product => product.id), ['remove_ads']);
    assert.equal(manager.purchaseFounderPass, undefined);
    assert.equal(manager.isAdFree(), false);
    assert.equal((await manager.purchaseRemoveAds()).ok, true);
    assert.equal(orderCount, 1);
    handlers.approved({
        products: [{ id: 'remove_ads' }], purchaseToken: 'test-token',
        finish: () => { finishCount++; }
    });
    assert.equal(finishCount, 1);
    assert.equal(manager.isAdFree(), true);
    assert.equal(context.SkinManager.isSkinUnlocked('sapphire'), true);
    assert.equal(changes, 1);
    owned = true;
    assert.equal((await manager.restorePurchases()).ok, true);
    assert.equal(changes, 1);
    unsubscribe();
});

test('legacy founder achievement does not count toward progress or prestige', () => {
    for (const useSafeStorage of [false, true]) {
        const saved = { day_one_skunk: { unlocked: true }, no_lifer: { unlocked: true } };
        const context = createContext({ chipsavage_achievements_v1: JSON.stringify(saved) });
        if (useSafeStorage) context.safeStorage = { getJSON: () => saved };
        const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'highscores.js'), 'utf8');
        vm.runInContext(source.replace(/^import .*;.*$/m, ''), context);
        const manager = context.Highscores;
        assert.deepEqual(Object.keys(manager.loadAchievements()), ['no_lifer']);
        assert.equal(manager.getPlayerTitle().count, 1);
        assert.equal(manager.getPrestigeScore(saved), 10);
        assert.equal(saved.day_one_skunk.unlocked, true);
    }
});