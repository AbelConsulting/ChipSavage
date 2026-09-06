/*!
 * Chip Savage
 * Copyright (c) 2026 Mephitideus Interactive. All Rights Reserved.
 * Proprietary and confidential — unauthorized copying, distribution, or use
 * of this file, via any medium, is strictly prohibited. See LICENSE for terms.
 */
// js/highscores.js
// Global high-score manager using the chipsavage.io leaderboard API.

// Import the REST API functions for the global leaderboard
import { submitScore as submitAPIScore, getHighScores as getAPIHighScores, checkHealth as checkAPIHealth, getEntitlements as fetchAPIEntitlements, setEntitlement as pushAPIEntitlement } from './firebase.js'; // REST client (no Firebase SDK)

// Bridge the entitlement helpers to the global scope so classic-script
// modules (PurchaseManager) can use them without bundling. PurchaseManager
// loads after this module.
try {
    window.ChipSavageEntitlementsAPI = {
        getEntitlements: fetchAPIEntitlements,
        setEntitlement: pushAPIEntitlement,
    };
} catch (_) {}

(function(window){
  const ACHIEVEMENTS_KEY = 'chipsavage_achievements_v1';
  const MAX_SCORES = 10; // The number of scores to show on the leaderboard.
  const PLAYER_NAME_KEY = 'chipsavage.playerName'; // Last submitted name (for own-row highlight).
  // Steam leaderboard API name — must match the leaderboard created in
  // Steamworks (Stats & Achievements → Leaderboards). electron/main.js will
  // findOrCreate it (Descending / Numeric) on first submit.
  const STEAM_LEADERBOARD = 'global_highscores';

  function _savePlayerName(name) {
    if (typeof name !== 'string' || !name.trim()) return;
    const trimmed = name.trim().slice(0, 16);
    if (window.safeStorage) window.safeStorage.set(PLAYER_NAME_KEY, trimmed);
    else { try { localStorage.setItem(PLAYER_NAME_KEY, trimmed); } catch (e) { /* private mode */ } }
  }
  function _loadPlayerName() {
    if (window.safeStorage) return window.safeStorage.get(PLAYER_NAME_KEY, '') || '';
    try { return localStorage.getItem(PLAYER_NAME_KEY) || ''; }
    catch (e) { return ''; }
  }
  function _formatAgo(ms) {
    if (!ms || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 5)   return 'just now';
    if (s < 60)  return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60)  return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24)  return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }
  const ACHIEVEMENT_DEFINITIONS = Object.freeze([
    // ── Combat Basics ──
    { id: 'first_kill', name: 'First Hole Won', desc: 'Defeat your first course rival', icon: '⛳', check: (stats) => statNumber(stats.enemiesDefeated) >= 1 },
    { id: 'enemy_slayer', name: 'Front Nine Finisher', desc: 'Defeat 50 rivals in one round', icon: '🏌️', check: (stats) => statNumber(stats.enemiesDefeated) >= 50 },
    { id: 'exterminator', name: 'Back Nine Bruiser', desc: 'Defeat 150 rivals in one round', icon: '🏌️', check: (stats) => statNumber(stats.enemiesDefeated) >= 150 },
    { id: 'genocide', name: 'Course Conqueror', desc: 'Defeat 300 rivals in one round', icon: '🏆', check: (stats) => statNumber(stats.enemiesDefeated) >= 300 },

    // ── Combo Mastery ──
    { id: 'combo_master', name: 'Birdie String', desc: 'Reach a 5-hit combo', icon: '🐦', check: (stats) => statNumber(stats.maxCombo) >= 5 },
    { id: 'combo_adept', name: 'Eagle String', desc: 'Reach a 10-hit combo', icon: '🦅', check: (stats) => statNumber(stats.maxCombo) >= 10 },
    { id: 'combo_legend', name: 'Albatross String', desc: 'Reach a 20-hit combo', icon: '🏌️', check: (stats) => statNumber(stats.maxCombo) >= 20 },
    { id: 'combo_god', name: 'Condor String', desc: 'Reach a 50-hit combo', icon: '🏆', check: (stats) => statNumber(stats.maxCombo) >= 50 },
    { id: 'multi_hit_master', name: 'Scramble Specialist', desc: 'Land 10 multi-hit attacks in one round', icon: '⛳', check: (stats) => statNumber(stats.multiKills) >= 10 },

    // ── Score ──
    { id: 'high_scorer', name: 'Clubhouse Contender', desc: 'Card over 50,000 points', icon: '🏌️', check: (stats) => statNumber(stats.score) >= 50000 },
    { id: 'score_attack', name: 'Money List Climber', desc: 'Card over 150,000 points', icon: '💰', check: (stats) => statNumber(stats.score) >= 150000 },
    { id: 'score_legend', name: 'Tour Leader', desc: 'Card over 500,000 points', icon: '🏆', check: (stats) => statNumber(stats.score) >= 500000 },

    // ── Kick ──
    { id: 'kick_initiate', name: 'Foot Wedge Rookie', desc: 'Use Kick 10 times in one round', icon: '🦵', check: (stats) => statNumber(stats.kicksUsed) >= 10 },
    { id: 'kick_master', name: 'Foot Wedge Pro', desc: 'Defeat 25 rivals with Kick', icon: '⚡', check: (stats) => statNumber(stats.kickKills) >= 25 },
    { id: 'kick_legend', name: 'Foot Wedge Legend', desc: 'Defeat 75 rivals with Kick', icon: '🏆', check: (stats) => statNumber(stats.kickKills) >= 75 },

    // ── Golf Shot ──
    { id: 'golf_shot_novice', name: 'Range Rookie', desc: 'Fire 5 Golf Shots in one round', icon: '⛳', check: (stats) => statNumber(stats.golfShotsFired) >= 5 },
    { id: 'golf_shooter', name: 'Shot Shaper', desc: 'Hit 20 rivals with Golf Shots in one round', icon: '🏌️', check: (stats) => statNumber(stats.enemiesHitByGolfShot) >= 20 },
    { id: 'golf_ace', name: 'Pin Seeker', desc: 'Hit 50 rivals with Golf Shots in one round', icon: '🏆', check: (stats) => statNumber(stats.enemiesHitByGolfShot) >= 50 },

    // ── Aerial Combat ──
    { id: 'air_juggler', name: 'High Tee', desc: 'Defeat 5 rivals while airborne', icon: '🦅', check: (stats) => statNumber(stats.airKills) >= 5 },
    { id: 'sky_warrior', name: 'Moon Ball', desc: 'Defeat 25 rivals while airborne', icon: '🌙', check: (stats) => statNumber(stats.airKills) >= 25 },

    // ── Accuracy & Precision ──
    { id: 'precision_striker', name: 'Fairway Finder', desc: '75% accuracy after 20+ attacks', icon: '🎯', check: (stats) => statNumber(stats.attacksAttempted) >= 20 && statNumber(stats.accuracy) >= 0.75 },
    { id: 'sharpshooter', name: 'Green in Regulation', desc: '90% accuracy after 50+ attacks', icon: '⛳', check: (stats) => statNumber(stats.attacksAttempted) >= 50 && statNumber(stats.accuracy) >= 0.90 },
    { id: 'never_miss', name: 'Dead Center', desc: '100% accuracy after 30+ attacks', icon: '🏌️', check: (stats) => statNumber(stats.attacksAttempted) >= 30 && statNumber(stats.accuracy) >= 1.0 },

    // ── Boss Hunting ──
    { id: 'boss_slayer', name: 'Match Play Rookie', desc: 'Defeat your first course champion', icon: '⛳', check: (stats) => statNumber(stats.bossesDefeated) >= 1 },
    { id: 'boss_crusher', name: 'Bracket Buster', desc: 'Defeat 3 course champions in one round', icon: '🏌️', check: (stats) => statNumber(stats.bossesDefeated) >= 3 },
    { id: 'boss_hunter', name: 'Tour Finalist', desc: 'Defeat 6 course champions in one round', icon: '🏆', check: (stats) => statNumber(stats.bossesDefeated) >= 6 },
    { id: 'veteran_hunter', name: 'Clubhouse Legend', desc: 'Defeat 20 course champions across all rounds', icon: '🏆', check: (stats) => statNumber(stats.totalBossesDefeated) >= 20 },

    // ── Survival & Grit ──
    { id: 'perfect_level', name: 'Clean Card', desc: 'Complete a hole without taking damage', icon: '📋', check: (stats) => statNumber(stats.perfectLevels) >= 1 },
    { id: 'iron_fur', name: 'Bogey-Free', desc: 'Finish 3 perfect holes in one round', icon: '⛳', check: (stats) => statNumber(stats.perfectLevels) >= 3 },
    { id: 'flawless_run', name: 'Perfect Card', desc: 'Complete the tour with 0 damage taken', icon: '✨', check: (stats) => !!stats.gameCompleted && statNumber(stats.damageTaken) === 0 },
    { id: 'close_call', name: 'Lip Out', desc: 'Survive a hit at under 15% health', icon: '🕳️', check: (stats) => statNumber(stats.closeCalls) >= 1 },
    { id: 'cheating_death', name: 'Mulligan Master', desc: 'Survive 5 close calls in one round', icon: '🏌️', check: (stats) => statNumber(stats.closeCalls) >= 5 },
    { id: 'survivor', name: 'Long Round', desc: 'Stay on the course for 10 minutes', icon: '⏰', check: (stats) => statNumber(stats.timeSurvived) >= 600 },
    { id: 'endurance', name: 'Marathon Round', desc: 'Stay on the course for 20 minutes', icon: '⌛', check: (stats) => statNumber(stats.timeSurvived) >= 1200 },
    { id: 'no_lives_lost', name: 'One-Ball Round', desc: 'Complete a hole without losing a life', icon: '🏐', check: (stats) => statNumber(stats.levelsCompleted) >= 1 && statNumber(stats.deathsThisRun) === 0 },

    // ── Collection & Exploration ──
    { id: 'relic_hunter', name: 'Trophy Cabinet', desc: 'Collect 10 Golden Cups across all rounds', icon: '🏆', check: (stats) => statNumber(stats.totalIdolsCollected) >= 10 },
    { id: 'idol_hoarder', name: 'Full Trophy Case', desc: 'Collect 50 Golden Cups across all rounds', icon: '🏆', check: (stats) => statNumber(stats.totalIdolsCollected) >= 50 },
    { id: 'master_collector', name: 'Triple Crown', desc: 'Complete 3 cup sets in one round', icon: '🏅', check: (stats) => statNumber(stats.idolSetsCompleted) >= 3 },
    { id: 'completionist', name: 'Grand Slam', desc: 'Collect all 18 cups in a single round', icon: '🏆', check: (stats) => statNumber(stats.idolsCollected) >= 18 },
    { id: 'power_hungry', name: 'Bag Fully Loaded', desc: 'Collect 15 course boosts in one round', icon: '🎒', check: (stats) => statNumber(stats.powerUpsCollected) >= 15 },

    // ── Chain Reactions ──
    { id: 'chain_reaction', name: 'Bank Shot', desc: 'Trigger an exploder chain knockout', icon: '💥', check: (stats) => statNumber(stats.exploderChainKills) >= 1 },
    { id: 'demolition_expert', name: 'Course Management', desc: 'Trigger 5 exploder chains in one round', icon: '📋', check: (stats) => statNumber(stats.exploderChainKills) >= 5 },

    // ── Speedrunning ──
    { id: 'speed_demon', name: 'Pace of Play', desc: 'Complete the tour in under 15 minutes', icon: '⚡', check: (stats) => !!stats.gameCompleted && statNumber(stats.completionTime) > 0 && statNumber(stats.completionTime) <= 900 },
    { id: 'speed_god', name: 'Speed Golf Champion', desc: 'Complete the tour in under 10 minutes', icon: '🏌️', check: (stats) => !!stats.gameCompleted && statNumber(stats.completionTime) > 0 && statNumber(stats.completionTime) <= 600 },

    // ── Campaign & Progression ──
    { id: 'world_saver', name: 'Major Champion', desc: 'Complete the Championship Tour', icon: '🏆', check: (stats) => !!stats.gameCompleted },
    { id: 'halfway_there', name: 'At the Turn', desc: 'Complete 3 holes in one round', icon: '🏌️', check: (stats) => statNumber(stats.levelsCompleted) >= 3 },

    // ── Cross-Run Dedication ──
    { id: 'dedicated', name: 'Weekend Golfer', desc: 'Play 10 rounds', icon: '⛳', check: (stats) => statNumber(stats.totalRuns) >= 10 },
    { id: 'addicted', name: 'Club Regular', desc: 'Play 50 rounds', icon: '🏌️', check: (stats) => statNumber(stats.totalRuns) >= 50 },
    { id: 'veteran', name: 'Course Veteran', desc: 'Play 100 rounds', icon: '🎖️', check: (stats) => statNumber(stats.totalRuns) >= 100 },
    { id: 'mass_extinction', name: 'Thousand-Stroke Club', desc: 'Defeat 1,000 rivals across all rounds', icon: '🏌️', check: (stats) => statNumber(stats.totalEnemiesDefeated) >= 1000 },
    { id: 'armageddon', name: 'Five-Thousand-Stroke Club', desc: 'Defeat 5,000 rivals across all rounds', icon: '🏆', check: (stats) => statNumber(stats.totalEnemiesDefeated) >= 5000 },
    { id: 'time_invested', name: 'Range Hours', desc: 'Play for 1 hour total', icon: '⏳', check: (stats) => statNumber(stats.totalPlayTime) >= 3600 },

    { id: 'no_lifer', name: 'Dawn-to-Dusk Golfer', desc: 'Play for 5 hours total', icon: '🌙', check: (stats) => statNumber(stats.totalPlayTime) >= 18000 },

    // ── Damage & Efficiency ──
    { id: 'glass_cannon', name: 'Risky Lie', desc: 'Deal 5,000+ damage while taking under 50', icon: '⛳', check: (stats) => statNumber(stats.totalDamage) >= 5000 && statNumber(stats.damageTaken) < 50 },
    { id: 'berserker', name: 'Power Hitter', desc: 'Deal 10,000 damage in a single round', icon: '🏌️', check: (stats) => statNumber(stats.totalDamage) >= 10000 },

    // ── Secret / Fun ──
    { id: 'multiplier_max', name: 'Handicap Hacker', desc: 'Reach a 3.0x combo multiplier', icon: '✖️', check: (stats) => statNumber(stats.bestMultiplier) >= 3.0 },
    { id: 'pacifist_start', name: 'Practice Swing', desc: 'Stay on course for 60 seconds without attacking', icon: '🏌️', check: (stats) => statNumber(stats.timeSurvived) >= 60 && statNumber(stats.attacksAttempted) === 0 },
  ]);

  function statNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function getAchievementDefinitions() {
    return ACHIEVEMENT_DEFINITIONS.map(({ check, ...achievement }) => ({ ...achievement }));
  }

  // ── Achievement-Based Titles ──
  // Earned by total achievement count; displayed on leaderboard next to player name.
  const TITLE_TIERS = Object.freeze([
    { min:  0, title: 'Rookie',          color: '#aaaaaa' },
    { min:  5, title: 'Caddie',          color: '#66bb6a' },
    { min: 10, title: 'Amateur',         color: '#42a5f5' },
    { min: 15, title: 'Club Pro',        color: '#ab47bc' },
    { min: 25, title: 'Tour Pro',        color: '#ffa726' },
    { min: 35, title: 'Major Champion',  color: '#ffd700' },
    { min: 45, title: 'Hall of Famer',   color: '#ff5252' },
    { min: 55, title: 'Golf Immortal',   color: '#e040fb' },
  ]);

  function getTitleForCount(count) {
    let tier = TITLE_TIERS[0];
    for (const t of TITLE_TIERS) {
      if (count >= t.min) tier = t;
    }
    return tier;
  }

  function getPlayerTitle() {
    const achievements = loadAchievements();
    const count = Object.values(achievements).filter(a => a && a.unlocked).length;
    return { ...getTitleForCount(count), count, total: ACHIEVEMENT_DEFINITIONS.length };
  }

  // ── Prestige Score ──
  // Weighted achievement points — harder achievements are worth more.
  const PRESTIGE_WEIGHTS = Object.freeze({
    // Easy (1 pt)
    first_kill: 1, golf_shot_novice: 1, combo_master: 1, chain_reaction: 1, boss_slayer: 1,
    close_call: 1, relic_hunter: 1, halfway_there: 1, dedicated: 1,
    // Medium (3 pt)
    enemy_slayer: 3, combo_adept: 3, high_scorer: 3, kick_initiate: 3, golf_shooter: 3,
    air_juggler: 3, precision_striker: 3, boss_crusher: 3, perfect_level: 3, survivor: 3,
    no_lives_lost: 3, power_hungry: 3, demolition_expert: 3, multi_hit_master: 3,
    mass_extinction: 3, time_invested: 3, multiplier_max: 3, idol_hoarder: 3,
    // Hard (5 pt)
    exterminator: 5, combo_legend: 5, score_attack: 5, kick_master: 5, golf_ace: 5,
    sky_warrior: 5, sharpshooter: 5, boss_hunter: 5, iron_fur: 5, cheating_death: 5,
    endurance: 5, master_collector: 5, speed_demon: 5, world_saver: 5,
    veteran_hunter: 5, addicted: 5, armageddon: 5, berserker: 5,
    // Epic (10 pt)
    genocide: 10, combo_god: 10, score_legend: 10, kick_legend: 10,
    never_miss: 10, flawless_run: 10, completionist: 10, speed_god: 10,
    veteran: 10, no_lifer: 10, glass_cannon: 10, pacifist_start: 10,
  });

  function getPrestigeScore(achievements) {
    const achs = achievements || loadAchievements();
    let total = 0;
    for (const { id } of ACHIEVEMENT_DEFINITIONS) {
      const data = achs[id];
      if (data && data.unlocked) total += (PRESTIGE_WEIGHTS[id] || 1);
    }
    return total;
  }

  function getMaxPrestige() {
    let total = 0;
    for (const a of ACHIEVEMENT_DEFINITIONS) total += (PRESTIGE_WEIGHTS[a.id] || 1);
    return total;
  }

  // Score validation to prevent obviously tampered scores
  function validateScore(score) {
    if (typeof score !== 'number' || score < 0 || !isFinite(score)) return false;
    if (score > 1000000) return false; // A reasonable maximum score to prevent nonsense submissions.
    return true;
  }

  // --- Achievement logic (uses local storage, unchanged) ---
  function loadAchievements(){
    try {
      const data = window.safeStorage
        ? window.safeStorage.getJSON(ACHIEVEMENTS_KEY, {})
        : JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY) || '{}');
      if (!data || typeof data !== 'object') return {};
      return Object.fromEntries(ACHIEVEMENT_DEFINITIONS
        .filter(achievement => Object.prototype.hasOwnProperty.call(data, achievement.id))
        .map(achievement => [achievement.id, data[achievement.id]]));
    } catch(e){ return {}; }
  }

  function saveAchievements(achievements){
    if (window.safeStorage) { window.safeStorage.setJSON(ACHIEVEMENTS_KEY, achievements); return; }
    try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(achievements)); }
    catch(e){ console.warn('Failed to save achievements', e); }
  }

  function checkAchievements(gameStats) {
    const achievements = loadAchievements();
    const newAchievements = [];
    const stats = gameStats || {};
    for (const achievement of ACHIEVEMENT_DEFINITIONS) {
      if (!achievements[achievement.id] && achievement.check(stats)) {
        achievements[achievement.id] = { unlocked: true, date: Date.now() };
        const { check, ...meta } = achievement;
        newAchievements.push(meta);
      }
    }
    if (newAchievements.length > 0) {
      saveAchievements(achievements);

      // ── Mirror unlocks to Google Play Games (best-effort, fire-and-forget) ──
      try {
        if (typeof window !== 'undefined' && window.PlayGamesServices && PlayGamesServices.isAvailable && PlayGamesServices.isAvailable()) {
          for (const ach of newAchievements) {
            try { PlayGamesServices.unlockAchievement(ach.id); } catch(e){}
          }
        }
      } catch(e) { /* GPGS mirroring must never break gameplay */ }

      // ── Mirror unlocks to Steam via Electron IPC (desktop build only) ──
      // electronAPI.platform === 'steam' is set by electron/preload.js. The
      // achievement `id` must match the Steam achievement API name exactly.
      try {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.platform === 'steam') {
          for (const ach of newAchievements) {
            try { window.electronAPI.unlockAchievement(ach.id).catch(() => {}); } catch(e){}
          }
        }
      } catch(e) { /* Steam mirroring must never break gameplay */ }

      // ── Dispatch a CustomEvent so toast/rail UI can react ──
      try {
        if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
          for (const ach of newAchievements) {
            window.dispatchEvent(new CustomEvent('chipsavage-achievement-unlocked', {
              detail: { id: ach.id, name: ach.name, desc: ach.desc, icon: ach.icon, date: Date.now() }
            }));
          }
        }
      } catch(e) { /* event dispatch must never break gameplay */ }
    }
    return newAchievements;
  }

  function renderAchievements(target, options = {}){
    const achievements = loadAchievements();
    const container = target || document.createElement('div');
    const settings = {
      includeTitle: true,
      variant: 'list',
      ...options
    };
    const achievementList = getAchievementDefinitions();

    container.innerHTML = '';
    if (settings.variant === 'cards') {
      container.className = 'info-achieve-grid';
      for (const ach of achievementList) {
        const isUnlocked = !!achievements[ach.id];
        const entry = document.createElement('div');
        entry.className = `info-achieve-card ${isUnlocked ? 'unlocked' : 'locked'}`;
        entry.setAttribute('data-ach-id', ach.id);

        const icon = document.createElement('span');
        icon.className = 'achieve-icon';
        icon.textContent = ach.icon;

        const info = document.createElement('div');
        info.className = 'achieve-info';

        const name = document.createElement('h4');
        name.textContent = ach.name;

        const desc = document.createElement('p');
        desc.textContent = ach.desc;

        const status = document.createElement('span');
        status.className = 'achieve-lock';
        status.textContent = isUnlocked ? '✓' : '🔒';

        info.appendChild(name);
        info.appendChild(desc);
        entry.appendChild(icon);
        entry.appendChild(info);
        entry.appendChild(status);
        container.appendChild(entry);
      }
      return container;
    }

    container.className = 'achievements-container';
    if (settings.includeTitle) {
      const title = document.createElement('h3');
      title.textContent = '🏆 ACHIEVEMENTS';
      container.appendChild(title);
    }

    for (const ach of achievementList) {
      const entry = document.createElement('div');
      entry.className = 'achievement-entry' + (achievements[ach.id] ? ' unlocked' : '');
      const icon = document.createElement('div');
      icon.className = 'achievement-icon';
      icon.textContent = ach.icon;
      const info = document.createElement('div');
      info.className = 'achievement-info';
      const name = document.createElement('div');
      name.className = 'achievement-name';
      name.textContent = ach.name;
      const desc = document.createElement('div');
      desc.className = 'achievement-desc';
      desc.textContent = ach.desc;
      info.appendChild(name);
      info.appendChild(desc);
      const status = document.createElement('div');
      status.className = 'achievement-status';
      status.textContent = achievements[ach.id] ? '✓' : '🔒';
      entry.appendChild(icon);
      entry.appendChild(info);
      entry.appendChild(status);
      container.appendChild(entry);
    }
    return container;
  }
  // --- End of achievement logic ---

  /**
   * Fetches scores from the chipsavage.io leaderboard.
   * @returns {Promise<Array>} A promise that resolves to an array of score objects.
   */
  async function loadScores(period) {
    try {
      const scores = await getAPIHighScores(MAX_SCORES, period || 'alltime');
      return scores || [];
    } catch(e) { 
      console.warn('Failed to load highscores from chipsavage.io', e);
      return null; 
    }
  }

  /**
   * True when running inside the Electron/Steam desktop build with a working
   * leaderboard IPC bridge.
   */
  function _isSteamDesktop() {
    return !!(
      typeof window !== 'undefined' &&
      window.electronAPI &&
      window.electronAPI.platform === 'steam' &&
      typeof window.electronAPI.getLeaderboard === 'function'
    );
  }

  /**
   * Fetches the top entries from the Steam leaderboard and maps them into the
   * shape renderScoreboard expects. Steam entries only carry name/score/rank,
   * so achievement/prestige/date fields are intentionally absent.
   * @returns {Promise<Array|null>}
   */
  async function loadSteamScores() {
    if (!_isSteamDesktop()) return [];
    try {
      const entries = await window.electronAPI.getLeaderboard(STEAM_LEADERBOARD, MAX_SCORES);
      if (!Array.isArray(entries)) return [];
      return entries.map(e => ({
        name: e.name || '???',
        score: Number(e.score) || 0,
      }));
    } catch (e) {
      console.warn('Failed to load Steam leaderboard', e);
      return null;
    }
  }

  /**
   * Checks if a score is high enough to make the leaderboard.
   * @param {number} score The player's score.
   * @returns {Promise<boolean>} A promise that resolves to true if it is a high score.
   */
  async function isHighScore(score){
    if (!validateScore(score)) return false;
    // Load the weekly, monthly and all-time boards in parallel. A score
    // qualifies if it makes the top-N of *any* period so the weekly/monthly
    // boards stay populated even when the score doesn't reach the all-time
    // threshold.
    //
    // NOTE: we intentionally do NOT gate this on a /health probe. A flaky or
    // cold-started health endpoint must never silently swallow a player's
    // score. If the boards can't be loaded at all, we optimistically treat the
    // run as qualifying and let the submit path (which the server validates and
    // dedupes) make the final call.
    let boards;
    try {
      boards = await Promise.all([
        loadScores('week'),
        loadScores('month'),
        loadScores('alltime'),
      ]);
    } catch (e) {
      console.warn('isHighScore: board load failed, allowing submission', e);
      return true;
    }
    // If every board failed to load, optimistically allow the submission.
    if (!boards.some(b => Array.isArray(b))) return true;
    for (const scores of boards) {
      if (!Array.isArray(scores)) continue;
      if (scores.length < MAX_SCORES) return true;
      if (score > scores[scores.length - 1].score) return true;
    }
    return false;
  }

  /**
   * Submits a score to the chipsavage.io leaderboard.
   * @param {number} score The player's score.
   * @param {string} name The player's name/initials.
   * @param {object} [gameStats] Game session stats for achievement checks.
   */
  // ── Dedupe state for score submissions ──
  // Prevents the rapid game-over → "Save" → onclick path from firing twice,
  // and prevents network retries from creating duplicate leaderboard rows.
  const _submitInflight = new Map();   // runId → in-flight promise
  const _submitCompleted = new Set();  // runIds that have already succeeded

  function _generateRunId() {
    try {
      if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Returns a stable run ID for the current session, generating + caching one
   * onto gameStats if missing. Callers (e.g. game.js) can also pre-set
   * gameStats.runId at run start.
   */
  function _runIdFor(gameStats) {
    if (gameStats && typeof gameStats.runId === 'string' && gameStats.runId) {
      return gameStats.runId;
    }
    const id = _generateRunId();
    if (gameStats && typeof gameStats === 'object') {
      try { gameStats.runId = id; } catch (e) { /* frozen object */ }
    }
    return id;
  }

  async function addScore(score, name, gameStats) {
    if (!validateScore(score)) {
      console.warn('Invalid score rejected', score);
      return false;
    }

    const runId = _runIdFor(gameStats);

    // Already submitted successfully — short-circuit (idempotent).
    if (_submitCompleted.has(runId)) {
      return true;
    }
    // Submission in flight for this run — return the existing promise so
    // overlapping callers all observe the same outcome instead of double-posting.
    if (_submitInflight.has(runId)) {
      return _submitInflight.get(runId);
    }

    const work = (async () => {
      try {
      // Remember this name so we can highlight the player's own row on the board.
      _savePlayerName(name);
      // Run achievement checks for this run (may unlock new ones)
      if (gameStats) checkAchievements(gameStats);
      // Build rich payload: all unlocked achievement IDs, prestige, title
      const allUnlocked = loadAchievements();
      const achievementIds = Object.keys(allUnlocked).filter(id => allUnlocked[id] && allUnlocked[id].unlocked);
      const prestige = getPrestigeScore(allUnlocked);
      const titleInfo = getPlayerTitle();
      const apiSubmitPromise = submitAPIScore(name, score, achievementIds, {
        prestige,
        title: titleInfo.title,
        achievementCount: titleInfo.count,
        level: gameStats ? (gameStats.levelsCompleted || 0) : 0,
        runId
      });
      const canSubmitPlayGames = !!(
        window.PlayGamesServices &&
        typeof PlayGamesServices.isAvailable === 'function' &&
        PlayGamesServices.isAvailable() &&
        typeof PlayGamesServices.submitScore === 'function'
      );

      const playGamesSubmitPromise = canSubmitPlayGames
        ? PlayGamesServices.submitScore(score)
        : Promise.resolve(false);

      // Steam leaderboard submit (desktop build only). electronAPI.platform
      // === 'steam' is set by electron/preload.js. Best-effort: a Steam
      // failure must not block the Cloud Functions submission.
      const canSubmitSteam = !!(
        window.electronAPI &&
        window.electronAPI.platform === 'steam' &&
        typeof window.electronAPI.submitScore === 'function'
      );
      const steamSubmitPromise = canSubmitSteam
        ? window.electronAPI.submitScore(STEAM_LEADERBOARD, score)
            .then(r => !!(r && r.success))
            .catch(() => false)
        : Promise.resolve(false);

      const [apiOk, playGamesOk, steamOk] = await Promise.all([
        apiSubmitPromise,
        playGamesSubmitPromise,
        steamSubmitPromise,
      ]);

      if (!apiOk && !playGamesOk && !steamOk) {
        console.error('Score submission failed for Cloud Functions, Play Games, and Steam');
      } else {
        // Mark this runId so a follow-up retry can't double-post.
        _submitCompleted.add(runId);
      }
      // Analytics: score submit
      try {
        if (typeof Analytics !== 'undefined') {
          Analytics.trackScoreSubmit({
            score,
            name,
            levelReached: gameStats ? (gameStats.levelsCompleted || 0) : 0,
            prestige
          });
        }
      } catch (e) { /* */ }
      return apiOk || playGamesOk || steamOk;
      } catch (e) {
        console.error("Failed to submit score to chipsavage.io", e);
        return false;
      } finally {
        _submitInflight.delete(runId);
      }
    })();

    _submitInflight.set(runId, work);
    return work;
  }

  /**
   * Shows a modal for the user to enter their initials for a new high score.
   * @param {number} score The player's score.
   * @param {object} gameStats Additional stats from the game session.
   * @param {function} onDone A callback function to execute after submission.
   */
  function promptForInitials(score, gameStats, onDone){
    try {
      // Defensive: remove any stale overlay from a previous prompt that
      // never tore down cleanly (e.g. page error mid-submit, rapid
      // game-over → victory transitions). Prevents stacked modals.
      try {
        document.querySelectorAll('.highscore-prompt-overlay').forEach((n) => {
          try { n.parentNode && n.parentNode.removeChild(n); } catch (_) {}
        });
      } catch (_) {}

      const overlay = document.createElement('div');
      overlay.className = 'highscore-prompt-overlay';

      const box = document.createElement('div');
      box.className = 'highscore-prompt-box';

      const title = document.createElement('div');
      title.className = 'highscore-prompt-title';
      title.textContent = '🏆 NEW HIGH SCORE!';

      const scoreLine = document.createElement('div');
      scoreLine.className = 'highscore-prompt-score';
      scoreLine.textContent = `Score: ${score.toLocaleString()}`;

      // Show player title and prestige
      const titleInfo = getPlayerTitle();
      const prestige = getPrestigeScore();
      const titleLine = document.createElement('div');
      titleLine.className = 'highscore-prompt-title-line';
      titleLine.innerHTML = `<span style="color:${titleInfo.color};font-weight:bold">${titleInfo.title}</span> \u2022 \u2b50 ${prestige} Prestige \u2022 ${titleInfo.count}/${titleInfo.total} Achievements`;

      const input = document.createElement('input');
      input.maxLength = 10; // Allow longer names
      input.placeholder = 'Enter Your Name';
      input.className = 'highscore-prompt-input';

      input.addEventListener('input', () => {
        input.style.borderColor = input.value.length > 0 ? '#4CAF50' : '#666';
      });

      const btnRow = document.createElement('div');
      btnRow.className = 'highscore-prompt-buttons';

      const ok = document.createElement('button');
      ok.textContent = '💾 SAVE';
      ok.className = 'highscore-prompt-save';
      
      ok.onclick = async () => {
        const name = (input.value.trim() || 'Ninja').slice(0,10);
        
        ok.disabled = true;
        skip.disabled = true;
        ok.textContent = 'SAVING...';

        await addScore(score, name, gameStats);
        
        box.innerHTML = '';
        const confirmTitle = document.createElement('div');
        confirmTitle.className = 'highscore-prompt-title';
        confirmTitle.textContent = '✓ Score Submitted!';
        confirmTitle.style.color = '#4CAF50';
        box.appendChild(confirmTitle);
        
        setTimeout(() => {
          try { document.body.removeChild(overlay); } catch(e){}
        }, 2500);
        
        if (onDone) {
            const newScores = await loadScores();
            onDone(newScores);
        }
      };

      const skip = document.createElement('button');
      skip.textContent = '❌ SKIP';
      skip.className = 'highscore-prompt-skip';
      skip.onclick = () => {
        try { document.body.removeChild(overlay); } catch(e) {}
        if (onDone) onDone();
      };

      input.addEventListener('keydown', (e)=> {
        if (e.key === 'Enter') ok.click();
        if (e.key === 'Escape') skip.click();
      });

      btnRow.appendChild(ok);
      btnRow.appendChild(skip);
      box.appendChild(title);
      box.appendChild(scoreLine);
      box.appendChild(titleLine);
      box.appendChild(input);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      input.focus();
    } catch (e) {
      console.warn('promptForInitials failed', e);
      if (onDone) onDone();
    }
  }

  /**
   * Fetches scores and renders them into a target HTML element.
   * @param {HTMLElement} target The element to render the scoreboard into.
   * @param {boolean} showDetails Whether to show extra details (not used with Firebase scores).
   */
  async function renderScoreboard(target, showDetails = false){
    const container = target || document.createElement('div');
    if (!target) container.className = 'scoreboard-container';

    // ── Build chrome (header + tabs + list shell) once, then refill on each load ──
    if (!container.querySelector('.scoreboard-header')) {
      container.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'scoreboard-header';

      const title = document.createElement('h3');
      title.textContent = '🏆 GLOBAL LEADERBOARD';
      title.className = 'scoreboard-title';
      header.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'scoreboard-meta';

      const updated = document.createElement('span');
      updated.className = 'scoreboard-updated';
      updated.textContent = '';
      meta.appendChild(updated);

      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.className = 'scoreboard-refresh';
      refreshBtn.setAttribute('aria-label', 'Refresh leaderboard');
      refreshBtn.innerHTML = '<span class="scoreboard-refresh-icon" aria-hidden="true">↻</span><span class="scoreboard-refresh-label">Refresh</span>';
      meta.appendChild(refreshBtn);

      header.appendChild(meta);
      container.appendChild(header);

      // ── Period tabs ──
      const tabs = document.createElement('div');
      tabs.className = 'scoreboard-tabs';
      tabs.setAttribute('role', 'tablist');
      const tabDefs = [
        { period: 'week',    label: 'This Week' },
        { period: 'month',   label: 'This Month' },
        { period: 'alltime', label: 'All Time' },
      ];
      // Desktop/Steam build: add a Steam friends+global tab.
      if (_isSteamDesktop()) {
        tabDefs.push({ period: 'steam', label: 'Steam' });
      }
      for (const def of tabDefs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'scoreboard-tab';
        btn.dataset.period = def.period;
        btn.textContent = def.label;
        btn.setAttribute('role', 'tab');
        if (def.period === 'alltime') {
          btn.classList.add('is-active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.setAttribute('aria-selected', 'false');
        }
        tabs.appendChild(btn);
      }
      container.appendChild(tabs);

      const list = document.createElement('div');
      list.className = 'scoreboard-list';
      container.appendChild(list);

      // Tab click: switch active period and reload
      tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.scoreboard-tab');
        if (!btn || btn.classList.contains('is-active')) return;
        tabs.querySelectorAll('.scoreboard-tab').forEach(b => {
          b.classList.remove('is-active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        container._scoreboardPeriod = btn.dataset.period;
        _fillScoreboard(container);
      });

      refreshBtn.addEventListener('click', () => { _fillScoreboard(container); });
    }

    // Set default period if not already set, then load
    if (!container._scoreboardPeriod) container._scoreboardPeriod = 'alltime';
    await _fillScoreboard(container);
    return container;
  }

  /**
   * Internal: loads scores for the container's active period and renders rows.
   * Separated so tabs and the refresh button both share identical behaviour.
   * @param {HTMLElement} container
   */
  async function _fillScoreboard(container) {
    const period   = container._scoreboardPeriod || 'alltime';
    const list     = container.querySelector('.scoreboard-list');
    const updatedEl = container.querySelector('.scoreboard-updated');
    const refreshBtn = container.querySelector('.scoreboard-refresh');

    // Loading state (preserves header + tabs so controls stay visible)
    if (refreshBtn) refreshBtn.disabled = true;
    list.innerHTML = '<div class="scoreboard-state scoreboard-state--loading">Loading global scores…</div>';
    if (updatedEl) updatedEl.textContent = '';

    let scores = null;
    let loadFailed = false;
    try {
      scores = period === 'steam' ? await loadSteamScores() : await loadScores(period);
    } catch (e) {
      loadFailed = true;
      console.warn('renderScoreboard: loadScores threw', e);
    }
    if (refreshBtn) refreshBtn.disabled = false;

    list.innerHTML = '';

    if (loadFailed || !Array.isArray(scores)) {
      const err = document.createElement('div');
      err.className = 'scoreboard-state scoreboard-state--error';
      err.textContent = "Couldn't reach the leaderboard. Tap Refresh to try again.";
      list.appendChild(err);
      return;
    }

    // Stamp + auto-tick the "updated Xs ago" label.
    const fetchedAt = Date.now();
    function _tickUpdated() {
      if (!updatedEl || !updatedEl.isConnected) return;
      updatedEl.textContent = 'Updated ' + _formatAgo(Date.now() - fetchedAt);
    }
    _tickUpdated();
    if (container._scoreboardTimer) {
      clearInterval(container._scoreboardTimer);
    }
    container._scoreboardTimer = setInterval(() => {
      if (!updatedEl || !updatedEl.isConnected) {
        clearInterval(container._scoreboardTimer);
        container._scoreboardTimer = null;
        return;
      }
      _tickUpdated();
    }, 10000);

    if (scores.length === 0) {
      const labels = { week: 'this week', month: 'this month', alltime: '', steam: 'on Steam' };
      const empty = document.createElement('div');
      empty.className = 'scoreboard-state scoreboard-state--empty';
      empty.textContent = labels[period]
        ? `No scores ${labels[period]} yet — be the first!`
        : 'No scores yet — set the bar.';
      list.appendChild(empty);
    } else {
      const myName = _loadPlayerName().toLowerCase();
      scores.forEach((scoreData, i) => {
        const entry = document.createElement('div');
        entry.className = 'scoreboard-entry';
        if (i === 0) entry.classList.add('gold');
        if (i === 1) entry.classList.add('silver');
        if (i === 2) entry.classList.add('bronze');
        if (myName && scoreData.name && scoreData.name.toLowerCase() === myName) {
          entry.classList.add('scoreboard-entry--me');
        }

        const rank = document.createElement('div');
        rank.className = 'scoreboard-rank';
        rank.textContent = `${i + 1}.`;

        const info = document.createElement('div');
        info.className = 'scoreboard-info';

        // Player name
        const nameRow = document.createElement('div');
        nameRow.className = 'scoreboard-name';
        nameRow.textContent = scoreData.name || '???';

        // Title badge (derived from achievement count)
        const activeAchievements = (Array.isArray(scoreData.achievements) ? scoreData.achievements : [])
          .filter(id => ACHIEVEMENT_DEFINITIONS.some(achievement => achievement.id === id));
        const achCount = activeAchievements.length;
        const titleData = scoreData.title
          ? TITLE_TIERS.find(t => t.title === scoreData.title) || getTitleForCount(achCount)
          : getTitleForCount(achCount);
        if (achCount > 0) {
          const titleBadge = document.createElement('span');
          titleBadge.className = 'scoreboard-title-badge';
          titleBadge.textContent = titleData.title;
          titleBadge.style.color = titleData.color;
          nameRow.appendChild(document.createTextNode(' '));
          nameRow.appendChild(titleBadge);
        }
        info.appendChild(nameRow);

        // Score line
        const scoreLine = document.createElement('div');
        scoreLine.className = 'scoreboard-score';
        scoreLine.textContent = scoreData.score.toLocaleString();
        info.appendChild(scoreLine);

        // Achievement badges row (show top 5 icons)
        if (achCount > 0) {
          const badgeRow = document.createElement('div');
          badgeRow.className = 'scoreboard-badges';
          const achIds = activeAchievements.slice(0, 5);
          for (const achId of achIds) {
            const def = ACHIEVEMENT_DEFINITIONS.find(a => a.id === achId);
            if (def) {
              const badge = document.createElement('span');
              badge.className = 'scoreboard-badge';
              badge.textContent = def.icon;
              badge.title = def.name;
              badgeRow.appendChild(badge);
            }
          }
          if (achCount > 5) {
            const more = document.createElement('span');
            more.className = 'scoreboard-badge-more';
            more.textContent = `+${achCount - 5}`;
            badgeRow.appendChild(more);
          }
          info.appendChild(badgeRow);
        }

        // Right column: prestige + date
        const rightCol = document.createElement('div');
        rightCol.className = 'scoreboard-right';

        const prestige = scoreData.prestige || 0;
        if (prestige > 0) {
          const prestigeEl = document.createElement('div');
          prestigeEl.className = 'scoreboard-prestige';
          prestigeEl.textContent = `⭐ ${prestige}`;
          prestigeEl.title = 'Prestige Score';
          rightCol.appendChild(prestigeEl);
        }

        const date = document.createElement('div');
        date.className = 'scoreboard-date';
        if (scoreData.timestamp) {
          const d = (scoreData.timestamp instanceof Date)
            ? scoreData.timestamp
            : new Date(scoreData.timestamp);
          date.textContent = d.toLocaleDateString();
        }
        rightCol.appendChild(date);

        entry.appendChild(rank);
        entry.appendChild(info);
        entry.appendChild(rightCol);
        list.appendChild(entry);
      });
    }
  }

  /**
   * Pings the leaderboard service to confirm it is online.
   * @returns {Promise<boolean>}
   */
  async function checkServiceHealth() {
    return checkAPIHealth();
  }

  // ── Survival Mode Local Leaderboard ─────────────────────────────────────────
  const SURVIVAL_SCORES_KEY = 'chipsavage_survival_scores_v1';
  const MAX_SURVIVAL_SCORES = 10;

  /**
   * Load local survival scores (sorted best-first by wave, then score).
   * @returns {Array<{wave:number, score:number, enemies:number, date:string}>}
   */
  function getSurvivalScores() {
    try {
      const raw = localStorage.getItem(SURVIVAL_SCORES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Save a new survival run to local storage. Keeps only top MAX_SURVIVAL_SCORES.
   * @param {{wave:number, score:number, enemies:number}} runData
   */
  function addSurvivalScore(runData) {
    try {
      const wave    = Math.max(0, parseInt(runData.wave,    10) || 0);
      const score   = Math.max(0, parseInt(runData.score,   10) || 0);
      const enemies = Math.max(0, parseInt(runData.enemies, 10) || 0);
      if (wave === 0 && score === 0) return; // nothing meaningful
      const existing = getSurvivalScores();
      existing.push({
        wave,
        score,
        enemies,
        date: new Date().toLocaleDateString(),
      });
      // Sort: highest wave first, break ties by score
      existing.sort((a, b) => b.wave - a.wave || b.score - a.score);
      const trimmed = existing.slice(0, MAX_SURVIVAL_SCORES);
      localStorage.setItem(SURVIVAL_SCORES_KEY, JSON.stringify(trimmed));
    } catch (e) { /* localStorage unavailable */ }
  }

  /**
   * Render the survival leaderboard into a target element.
   * @param {HTMLElement} target
   */
  function renderSurvivalBoard(target) {
    if (!target) return;
    const scores = getSurvivalScores();

    target.innerHTML = '';

    if (scores.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'scoreboard-state scoreboard-state--empty';
      empty.textContent = 'No Back Nine rounds yet — tee off to set the clubhouse mark!';
      target.appendChild(empty);
      return;
    }

    // Personal best callout
    const best = scores[0];
    const pbBar = document.createElement('div');
    pbBar.className = 'survival-pb-bar';
    pbBar.innerHTML = `
      <span class="survival-pb-label">Personal Best</span>
      <span class="survival-pb-wave">Pairing ${best.wave}</span>
      <span class="survival-pb-score">${best.score.toLocaleString()} pts</span>
    `;
    target.appendChild(pbBar);

    // Rows
    scores.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'scoreboard-entry survival-entry';
      if (i === 0) row.classList.add('gold');
      if (i === 1) row.classList.add('silver');
      if (i === 2) row.classList.add('bronze');

      const rank = document.createElement('div');
      rank.className = 'scoreboard-rank';
      rank.textContent = `${i + 1}.`;

      const info = document.createElement('div');
      info.className = 'scoreboard-info';

      const nameLine = document.createElement('div');
      nameLine.className = 'scoreboard-name';
      nameLine.textContent = `Pairing ${entry.wave}`;

      const detailLine = document.createElement('div');
      detailLine.className = 'scoreboard-score';
      detailLine.textContent = `${entry.score.toLocaleString()} pts  ·  ${entry.enemies} rivals`;

      info.appendChild(nameLine);
      info.appendChild(detailLine);

      const right = document.createElement('div');
      right.className = 'scoreboard-right';
      const dateLine = document.createElement('div');
      dateLine.className = 'scoreboard-date';
      dateLine.textContent = entry.date || '';
      right.appendChild(dateLine);

      row.appendChild(rank);
      row.appendChild(info);
      row.appendChild(right);
      target.appendChild(row);
    });
  }

  // Expose the public API
  window.Highscores = {
    // Global scores
    loadScores,
    isHighScore,
    addScore,
    renderScoreboard,
    checkServiceHealth,
    // ---
    promptForInitials,
    // Local achievements
    getAchievementDefinitions,
    loadAchievements,
    saveAchievements,
    checkAchievements,
    renderAchievements,
    validateScore,
    // Title & Prestige system
    getPlayerTitle,
    getPrestigeScore,
    getMaxPrestige,
    getTitleForCount,
    // Survival mode local leaderboard
    getSurvivalScores,
    addSurvivalScore,
    renderSurvivalBoard,
  };

})(window);
