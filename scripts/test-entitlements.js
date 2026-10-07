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

test('Skin Pack and Steam unlock three skins and retain saved preferences', () => {
    for (const platform of ['web', 'steam']) {
        const context = createContext({
            'chipsavage.skinPackOwned': platform === 'web' ? '1' : '0',
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

function createNativeContext() {
    const context = createContext();
    const handlers = {};
    const registrations = [];
    const state = { owned: false, orderCount: 0, orderError: null, restoreError: null };
    const product = {
        id: 'skin_pack', pricing: { price: '$1.99' },
        getOffer: () => ({ order: async () => { state.orderCount++; return state.orderError; } })
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
            owned: id => id === 'skin_pack' && state.owned,
            get: id => id === 'skin_pack' ? product : null,
            restorePurchases: async () => {
                if (state.restoreError) throw state.restoreError;
                handlers.receiptUpdated({});
            }
        }
    };
    loadScript(context, 'purchaseManager.js');
    loadScript(context, 'skinManager.js');
    context.SkinManager.initialize();
    return { context, handlers, registrations, state };
}

test('Skin Pack registers, purchases, restores, and notifies skin listeners', async () => {
    const { context, handlers, registrations, state } = createNativeContext();
    let finishCount = 0;
    let changes = 0;
    const unsubscribe = context.SkinManager.onChange(() => changes++);
    const manager = context.PurchaseManager;
    await manager.initialize();
    changes = 0;
    assert.deepEqual(registrations.map(product => product.id), ['skin_pack']);
    assert.equal(manager.purchaseFounderPass, undefined);
    assert.equal(manager.hasSkinPack(), false);
    assert.equal((await manager.purchaseSkinPack()).ok, true);
    assert.equal(manager.hasSkinPack(), false);
    assert.equal(state.orderCount, 1);
    handlers.approved({
        products: [{ id: 'skin_pack' }], purchaseToken: 'test-token',
        finish: () => { finishCount++; }
    });
    assert.equal(finishCount, 1);
    assert.equal(manager.hasSkinPack(), true);
    assert.equal(context.localStorage.getItem('chipsavage.skinPackOwned'), '1');
    assert.equal(context.SkinManager.isSkinUnlocked('sapphire'), true);
    assert.equal(changes, 1);
    assert.equal((await manager.purchaseSkinPack()).reason, 'already-owned');
    assert.equal(state.orderCount, 1);
    state.owned = true;
    assert.equal((await manager.restorePurchases()).ok, true);
    assert.equal(changes, 1);
    unsubscribe();
});

test('store restore unlocks skins on a fresh installation without a new purchase', async () => {
    const { context, state } = createNativeContext();
    await context.PurchaseManager.initialize();
    assert.equal(context.PurchaseManager.hasSkinPack(), false);
    state.owned = true;
    assert.equal((await context.PurchaseManager.restorePurchases()).ok, true);
    assert.equal(context.PurchaseManager.hasSkinPack(), true);
    assert.equal(context.SkinManager.isSkinUnlocked('steel'), true);
    assert.equal(state.orderCount, 0);
});

test('ownership returned during initialization unlocks the Skin Pack', async () => {
    const { context, state } = createNativeContext();
    state.owned = true;
    await context.PurchaseManager.initialize();
    assert.equal(context.PurchaseManager.hasSkinPack(), true);
    assert.equal(context.SkinManager.isSkinUnlocked('sapphire'), true);
});

test('unrelated transactions do not unlock skins or store purchase tokens', async () => {
    const { context, handlers } = createNativeContext();
    await context.PurchaseManager.initialize();
    let finishes = 0;
    const transaction = { products: [{ id: 'unrelated_product' }], purchaseToken: 'unrelated-token', finish() { finishes++; } };
    handlers.approved(transaction);
    handlers.finished(transaction);
    assert.equal(finishes, 1);
    assert.equal(context.PurchaseManager.hasSkinPack(), false);
    assert.equal(context.localStorage.getItem('chipsavage.pendingIapPurchases'), null);
});

test('billing rejections and restore errors are returned without granting ownership', async () => {
    const { context, state } = createNativeContext();
    await context.PurchaseManager.initialize();
    for (const [error, reason] of [
        [{ code: 1, message: 'cancelled' }, 'user-cancelled'],
        [{ code: 7, message: 'billing unavailable' }, 'billing unavailable']
    ]) {
        state.orderError = error;
        const result = await context.PurchaseManager.purchaseSkinPack();
        assert.equal(result.ok, false);
        assert.equal(result.reason, reason);
        assert.equal(context.PurchaseManager.hasSkinPack(), false);
    }
    state.restoreError = new Error('restore unavailable');
    assert.equal((await context.PurchaseManager.restorePurchases()).reason, 'restore unavailable');
    assert.equal(context.PurchaseManager.hasSkinPack(), false);
});

test('skin purchases synchronize only the skin SKU and verified purchase token', async () => {
    const { context, handlers } = createNativeContext();
    const pushes = [];
    context.PlayGamesServices = { getPlayerId: () => 'test-player' };
    context.ChipSavageEntitlementsAPI = {
        setEntitlement: async (...args) => { pushes.push(args); return true; }
    };
    await context.PurchaseManager.initialize();
    handlers.approved({
        products: [{ id: 'skin_pack' }], purchaseToken: 'skin-token', finish() {}
    });
    await Promise.resolve();
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][0], 'test-player');
    assert.equal(pushes[0][1], 'skin_pack');
    assert.equal(pushes[0][2].purchaseToken, 'skin-token');
    assert.equal(pushes[0][2].productId, 'skin_pack');
    assert.equal(context.localStorage.getItem('chipsavage.pendingIapPurchases'), '{}');
});

test('unpublished ad-free test flags do not grant Skin Pack ownership', async () => {
    const context = createContext({ 'chipsavage.adFree': '1' });
    loadScript(context, 'purchaseManager.js');
    loadScript(context, 'skinManager.js');
    await context.PurchaseManager.initialize();
    assert.equal(context.PurchaseManager.hasSkinPack(), false);
    assert.equal(context.SkinManager.hasAnyUnlockedSkin(), false);
    assert.equal(context.PurchaseManager.isAdFree, undefined);
    assert.equal(context.PurchaseManager.purchaseRemoveAds, undefined);
    assert.equal(context.PurchaseManager.PRODUCT_ID_REMOVE_ADS, undefined);
    assert.equal(context.PurchaseManager.PRODUCT_ID_SKIN_PACK, 'skin_pack');
});

test('web purchases and restores explicitly report unsupported without unlocking skins', async () => {
    const context = createContext();
    loadScript(context, 'purchaseManager.js');
    await context.PurchaseManager.initialize();
    assert.equal(context.PurchaseManager.isReady(), true);
    assert.equal((await context.PurchaseManager.purchaseSkinPack()).reason, 'web-not-supported');
    assert.equal((await context.PurchaseManager.restorePurchases()).reason, 'web-not-supported');
    assert.equal(context.PurchaseManager.hasSkinPack(), false);
});

test('Steam includes cosmetics without registering or ordering purchases', async () => {
    const context = createContext({}, 'steam');
    loadScript(context, 'purchaseManager.js');
    loadScript(context, 'skinManager.js');
    await context.PurchaseManager.initialize();
    assert.equal(context.PurchaseManager.hasSkinPack(), true);
    assert.equal(context.SkinManager.isSkinUnlocked('steel'), true);
    assert.equal((await context.PurchaseManager.purchaseSkinPack()).reason, 'already-owned');
});

test('remote skin entitlement restores cosmetics without re-pushing ownership', async () => {
    const context = createContext();
    let pushes = 0;
    context.PlayGamesServices = { getPlayerId: () => 'test-player' };
    context.ChipSavageEntitlementsAPI = {
        getEntitlements: async () => ({ skinPackOwned: true }),
        setEntitlement: async () => { pushes++; return true; }
    };
    loadScript(context, 'purchaseManager.js');
    loadScript(context, 'skinManager.js');
    context.SkinManager.initialize();
    let changes = 0;
    context.SkinManager.onChange(() => changes++);
    await context.PurchaseManager.syncRemoteEntitlements();
    assert.equal(context.PurchaseManager.hasSkinPack(), true);
    assert.equal(context.SkinManager.isSkinUnlocked('amethyst'), true);
    assert.equal(context.localStorage.getItem('chipsavage.skinPackOwned'), '1');
    assert.equal(changes, 1);
    assert.equal(pushes, 0);
    await context.PurchaseManager.syncRemoteEntitlements(true);
    assert.equal(changes, 1);
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