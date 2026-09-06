const SkinManager = (() => {
    'use strict';

    const VALID_SKIN_VARIANTS = Object.freeze(['sapphire', 'amethyst', 'steel']);
    const STORAGE_KEY_ENABLED = 'chipsavage.useGoldSkin';
    const STORAGE_KEY_VARIANT = 'chipsavage.skinVariant';
    const listeners = new Set();
    let initialized = false;
    let enabled = readPreference(STORAGE_KEY_ENABLED) === '1';
    let variant = readPreference(STORAGE_KEY_VARIANT);
    if (!VALID_SKIN_VARIANTS.includes(variant)) variant = VALID_SKIN_VARIANTS[0];

    function readPreference(key) {
        try { return localStorage.getItem(key); }
        catch (error) { return null; }
    }

    function notify() {
        for (const listener of listeners) {
            try { listener(hasAnyUnlockedSkin()); } catch (error) {}
        }
    }

    function initialize() {
        if (initialized) return;
        initialized = true;
        if (window.PurchaseManager && typeof PurchaseManager.onChange === 'function') {
            PurchaseManager.onChange(notify);
        }
    }

    function hasAnyUnlockedSkin() {
        return window.PLATFORM === 'steam' || readPreference('chipsavage.adFree') === '1';
    }

    function isSkinUnlocked(id) {
        return VALID_SKIN_VARIANTS.includes(id) && hasAnyUnlockedSkin();
    }

    function isGoldSkinEnabled() {
        return enabled && isSkinUnlocked(variant);
    }

    function setGoldSkinEnabled(on) {
        const next = !!on;
        if (enabled === next) return;
        enabled = next;
        try {
            if (next) localStorage.setItem(STORAGE_KEY_ENABLED, '1');
            else localStorage.removeItem(STORAGE_KEY_ENABLED);
        } catch (error) {}
        notify();
    }

    function getSkinVariant() { return variant; }
    function getSkinVariants() { return VALID_SKIN_VARIANTS.slice(); }
    function getUnlockedSkinVariants() { return VALID_SKIN_VARIANTS.filter(isSkinUnlocked); }

    function setSkinVariant(id) {
        if (!isSkinUnlocked(id)) return false;
        if (variant === id) return true;
        variant = id;
        try { localStorage.setItem(STORAGE_KEY_VARIANT, id); } catch (error) {}
        notify();
        return true;
    }

    function onChange(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return {
        initialize, onChange, isGoldSkinEnabled, setGoldSkinEnabled,
        getSkinVariant, getSkinVariants, setSkinVariant, isSkinUnlocked,
        hasAnyUnlockedSkin, getUnlockedSkinVariants
    };
})();

if (typeof window !== 'undefined') window.SkinManager = SkinManager;