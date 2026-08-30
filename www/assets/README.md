# Chip Savage — Asset Spec

All sprites are **PNG** (WebP also accepted as a fallback). The engine tries `.png` first,
then `.webp`, then `@1x` / `@2x` suffixed variants of each.

---

## sprites/characters/

All player sheets are **horizontal strips** — frames laid out left-to-right, no padding between frames.

| File | Frames | Frame size | Sheet size | Notes |
|---|---|---|---|---|
| `chip_idle.png` | 4 | 64 × 64 | 256 × 64 | Standing idle loop |
| `chip_walk.png` | 4 | 64 × 64 | 256 × 64 | Walk cycle |
| `chip_jump.png` | 4 | 64 × 64 | 256 × 64 | Jump arc |
| `chip_climb.png` | 4 | 64 × 64 | 256 × 64 | Ladder/rope climb loop |
| `chip_attack.png` | 4 | 64 × 64 | 256 × 64 | Basic melee attack |
| `chip_kick.png` | 4 | 64 × 64 | 256 × 64 | Kick dash move (invincible frames) |
| `chip_golf_shot.png` | 4 | 64 × 64 | 256 × 64 | Golf Shot animation (ranged) |
| `chip_hurt.png` | 2 | 64 × 64 | 128 × 64 | Hit reaction (2 frames only) |
| `chip_death.png` | 4 | 64 × 64 | 256 × 64 | Death animation |

**Tip:** All character sprites face **right**. The engine mirrors them horizontally when facing left.

---

## sprites/enemies/

Same horizontal strip format. Standard enemies use 64 × 64 frames; bosses use 96 × 96.

### Standard enemies

| Prefix | Frames each | Frame size | Animations needed |
|---|---|---|---|
| `basic_` | 4 | 64 × 64 | `basic_idle`, `basic_walk`, `basic_attack`, `basic_hurt` |
| `second_` | 4 / 2 hurt | 64 × 64 | `second_idle`, `second_walk`, `second_attack`, `second_hurt` (2 frames) |
| `third_` | 4 | 64 × 64 | `third_idle`, `third_walk`, `third_attack`, `third_hurt` |
| `fourth_` | 4 | 64 × 64 | `fourth_idle`, `fourth_walk`, `fourth_attack`, `fourth_hurt` |
| `fifth_` | 4 | 64 × 64 | `fifth_idle`, `fifth_walk`, `fifth_attack`, `fifth_hurt` |

### Bosses

| Prefix | Frames each | Frame size | Animations needed |
|---|---|---|---|
| `boss_` | 4 | 96 × 96 | `boss_idle`, `boss_walk`, `boss_attack1`i,  `boss_hurt` |
| `boss2_` | 4 | 96 × 96 | `boss2_idle`, `boss2_walk`, `boss2_attack`, `boss2_hurt` |
| `boss3_` | 4 | 96 × 96 | `boss3_idle`, `boss3_walk`, `boss3_attack`, `boss3_hurt` |
| `boss4_` | 4 | 96 × 96 | `boss4_idle`, `boss4_walk`, `boss4_attack`, `boss4_hurt` |
| `boss5_` | 4 | 96 × 96 | `boss5_idle`, `boss5_walk`, `boss5_attack`, `boss5_hurt` |
| `boss6_` | 4 | 96 × 96 | `boss6_idle`, `boss6_walk`, `boss6_attack`, `boss6_hurt` |
| `boss7_` | 4 | 96 × 96 | `boss7_idle`, `boss7_walk`, `boss7_attack`, `boss7_hurt` |
| `boss8_` | 4 | 96 × 96 | `boss8_walk`, `boss8_attack`, `boss8_hurt` (no idle) |
| `boss9_` | 4 | 96 × 96 | `boss9_idle`, `boss9_walk`, `boss9_attack`, `boss9_hurt` |

---

## sprites/backgrounds/

### Panorama backgrounds

The key in `levelData.js` is `bg_<name>`. Two naming conventions are supported:

- **Numbered** (e.g. `bg_1`): loads `assets/sprites/backgrounds/bg_1.png` directly.
- **Named** (e.g. `bg_forest`): strips the `bg_` prefix and appends `_bg`, so `bg_forest` → loads `assets/sprites/backgrounds/forest_bg.png`.

| File | Key | Used in level |
|---|---|---|
| `bg_1.png` | `bg_1` | Worlds 1–2 (Forest Outskirts) |
| `bg_2.png` | `bg_2` | Worlds 3–4 (Skunk City) |
| `bg_3.png` | `bg_3` | Worlds 5–6 (Mountain Dojo) |
| `caves_crystal_bg.png` | `bg_caves_crystal` | World 7 |
| `cave_depths_bg.png` | `bg_cave_depths` | World 8 |
| `neon_bg.png` | `bg_neon` | World 9 |
| `mountains_bg.png` | `bg_mountains` | World 10 |
| `alleyway_bg.png` | `bg_alleyway` | World 11 |
| `space_bg.png` | `bg_space` | World 12 |
| `final_bg.png` | `bg_final` | World 13 (final boss) |

**Recommended size:** 1920 × 720 px minimum (wider than the 1280 px viewport to allow parallax scrolling).
The engine scales the image to fill the canvas height, so any wide landscape image works.

### Tiles (`sprites/backgrounds/tiles/`)

Tiles are used for platforms and ground. All tiles are **single-frame square images**.

| File | Recommended size | Purpose |
|---|---|---|
| `ground_tile.png` | 64 × 64 | Main ground surface |
| `ground2_tile.png` | 64 × 64 | Alternate ground (world 2 variant) |
| `ground3_tile.png` | 64 × 64 | Alternate ground (world 3 variant) |
| `platform_tile.png` | 64 × 64 | Floating platform |
| `platform2_tile.png` | 64 × 64 | Platform variant 2 |
| `platform3_tile.png` | 64 × 64 | Platform variant 3 |
| `platform4_tile.png` | 64 × 64 | Platform variant 4 |
| `platform5_tile.png` | 64 × 64 | Platform variant 5 |
| `platform6_tile.png` | 64 × 64 | Platform variant 6 |
| `wall_tile.png` | 64 × 64 | Vertical wall surface |

---

## sprites/items/

| File | Size | Purpose |
|---|---|---|
| `health_regen.png` | 32 × 32 | Health regeneration pickup |
| `extra_life.png` | 32 × 32 | Extra life heart |
| `golden_idol.png` | 30 × 30 | Collectible golden trophy (3 per level) |
| `speed_boost.png` | 32 × 32 | Speed boost pickup |
| `damage_boost.png` | 32 × 32 | Damage boost pickup |
| `golf_ammo.png` | 32 × 32 | Golf Shot ammo pickup |

---

## sprites/ui/

| File | Notes |
|---|---|
| `heart.png` | Life indicator in HUD |
| `hud_icons.png` | Optional sprite sheet for HUD elements |

---

## audio/sfx/

WAV or OGG files. Key names used by the engine:

`kick.wav`, `kick_hit.wav`, `golf_shot.wav`, `attack1.wav`, `attack2.wav`, `attack3.wav`,
`player_hit.wav`, `jump.wav`, `land.wav`, `footstep.wav`, `combo_break.wav`,
`dash.wav`, `achievement_unlock.wav`, `ui_hover.wav`, `ui_confirm.wav`,
`enemy_hurt.wav`, `enemy_death.wav`, `boss_hurt.wav`, `boss_roar.wav`,
`explosion.wav`, `item_pickup.wav`, `idol_pickup.wav`, `extra_life.wav`

## audio/music/

| File | Purpose |
|---|---|
| `theme_menu.ogg` | Main menu / title screen |
| `theme_stage.ogg` | Normal gameplay |
| `theme_boss.ogg` | Boss fight |
| `theme_victory.ogg` | Level complete sting |

---

## icons/

| File | Size | Purpose |
|---|---|---|
| `icon-192x192.png` | 192 × 192 | PWA / Android home screen |
| `icon-512x512.png` | 512 × 512 | PWA splash / Play Store |
| `favicon.ico` | 32 × 32 | Browser tab |
