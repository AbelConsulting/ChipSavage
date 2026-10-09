/*!
 * Chip Savage
 * Copyright (c) 2026 Mephitideus Interactive. All Rights Reserved.
 * Proprietary and confidential — unauthorized copying, distribution, or use
 * of this file, via any medium, is strictly prohibited. See LICENSE for terms.
 */
class Level {
    /**
     * Load level data from an external configuration object.
     * Accepts partial data; missing fields will keep previous values.
     * @param {Object} levelData
     */
    loadLevel(levelData = {}) {
        this.width = levelData.width || this.width;
        this.height = levelData.height || this.height;
        // Optional background name (matches keys from spriteLoader)
        this.backgroundName = levelData.background || levelData.backgroundName || this.backgroundName || 'bg_city';
        // Additional background layers
        this.backgroundLayers = Array.isArray(levelData.backgroundLayers) ? levelData.backgroundLayers.map(layer => ({ ...layer })) : [];
        // Lazy-load background panoramas (non-blocking). Construct a simple
        // path mapping from sprite key to expected asset path and request
        // the spriteLoader to fetch them only when a level references them.
        try {
            if (typeof spriteLoader !== 'undefined') {
                const ensureLoaded = (name) => {
                    if (!name) return;
                    if (spriteLoader.getSprite(name)) return; // already present
                    // Numbered keys (bg_1, bg_2, …) map directly to assets/sprites/backgrounds/bg_N.png.
                    // Named keys (bg_forest, bg_city, …) use the legacy xxx_bg suffix convention.
                    const isNumbered = /^bg_\d+$/.test(name);
                    const base = name.replace(/^bg_/, '');
                    const basePath = isNumbered
                        ? `assets/sprites/backgrounds/${name}`
                        : `assets/sprites/backgrounds/${base}_bg`;
                    // Use the robust variant loader which tries webp/png and suffixes
                    try {
                        spriteLoader.loadSpriteBest(name, basePath).then(img => { try { this.cachedSprites[name] = img; } catch (e) { __err('level', e); } }).catch((e) => { __err('level', e); });
                    } catch (e) { __err('level', e); }
                };

                ensureLoaded(this.backgroundName);
                for (const layer of this.backgroundLayers) {
                    if (layer && layer.name) ensureLoaded(layer.name);
                }
            }
        } catch (e) { __err('level', e); }
        // Per-level background parallax factor (0..1). Lower = slower (farther away).
        this.backgroundParallax = (typeof levelData.backgroundParallax !== 'undefined') ? levelData.backgroundParallax : (typeof Config !== 'undefined' ? Config.BACKGROUND_PARALLAX : 0.5);
        
        // Initialize platforms (static, moving, and climbable)
        // Accept partial data: if platforms is missing, keep existing platforms.
        const incomingPlatforms = Array.isArray(levelData.platforms) ? levelData.platforms : this.platforms;
        this._motionTime = 0;
        this.pendingPowerupDrops = [];
        this.platforms = (Array.isArray(incomingPlatforms) ? incomingPlatforms : []).map(p => {
            const platform = {
                ...p,
                initialX: p.x,
                initialY: p.y,
                timeOffset: typeof p.timeOffset === 'number' ? p.timeOffset : 0,
                dx: 0,
                dy: 0
            };
            if (platform.type === 'moving') {
                const axis = platform.axis === 'y' ? 'y' : 'x';
                const range = typeof platform.range === 'number' ? platform.range : 100;
                platform[axis] += Math.sin(platform.timeOffset) * range;
            }
            platform.previousX = platform.x;
            platform.previousY = platform.y;
            return platform;
        });
        for (const [field, powerupType] of [
            ['speedBoosts', 'SPEED_BOOST'],
            ['damageBoosts', 'DAMAGE_BOOST'],
            ['skunkPowerups', 'SKUNK_POWERUP']
        ]) {
            for (const spawn of levelData[field] || []) {
                this.spawnPowerupShield(spawn, powerupType);
            }
        }
        // Optional enemy spawn points (array of { x: number|'left'|'right', y: number })
        this.spawnPoints = Array.isArray(levelData.spawnPoints) ? levelData.spawnPoints.slice() : null;

        // Optional golden trophy spawn points (array of { x: number, y: number })
        this.idols = Array.isArray(levelData.idols) ? levelData.idols.map(p => ({ ...p })) : [];
        
        // Store boss and completion config for Game logic
        this.bossConfig = levelData.boss || null;
        this.completionConfig = levelData.completion || null;

        // Mark static layer dirty so it will be re-rendered on next draw
        this._staticNeedsUpdate = true;
        // Hazards removed: clear all hazards on load to prevent spawning
        const hadHazards = Array.isArray(levelData.hazards) && levelData.hazards.length > 0;
        this.hazards = [];
        if (hadHazards && typeof Config !== 'undefined' && Config.DEBUG && typeof console !== 'undefined' && console.log) console.log(`Removed ${levelData.hazards.length} hazards from level load (global hazard removal).`);
    }

    /**
     * Update animated level elements (moving platforms, hazards).
     * @param {number} deltaTime - Time (seconds) since last update
     */
    update(deltaTime) {
        // Update moving platforms
        this._motionTime += deltaTime;
        const time = this._motionTime;
        
        this.platforms.forEach(plat => {
            if (plat.type === 'moving') {
                // Simple Sine wave movement
                const range = typeof plat.range === 'number' ? plat.range : 100;
                const speed = typeof plat.speed === 'number' ? plat.speed : 1;
                plat.previousX = plat.x;
                plat.previousY = plat.y;
                
                if (plat.axis === 'y') {
                    plat.y = plat.initialY + Math.sin(time * speed + plat.timeOffset) * range;
                } else {
                    plat.x = plat.initialX + Math.sin(time * speed + plat.timeOffset) * range;
                }
                // Actual frame displacement keeps riders attached at direction changes.
                plat.dx = plat.x - plat.previousX;
                plat.dy = plat.y - plat.previousY;
            }
        });

        for (const shield of this.platforms) {
            if (!shield.supportPlatform || shield.supportPlatform.type !== 'moving') continue;
            shield.x = shield.supportPlatform.x + shield.supportOffsetX;
            shield.y = shield.supportPlatform.y - shield.height - 25;
        }

        // Update moving hazards (if any)
        if (this.hazards && this.hazards.length > 0) {
            this.hazards.forEach(h => {
                // Generic moving hazard support: if axis and range are present, animate position
                if (h.axis && h.range) {
                    const speed = h.speed || 1.0;
                    if (!('initialX' in h)) h.initialX = h.x;
                    if (!('initialY' in h)) h.initialY = h.y;
                    if (!('timeOffset' in h)) h.timeOffset = Math.random() * Math.PI * 2;
                    if (h.axis === 'y') {
                        h.y = h.initialY + Math.sin(time * speed + h.timeOffset) * h.range;
                    } else {
                        h.x = h.initialX + Math.sin(time * speed + h.timeOffset) * h.range;
                    }
                }
            });
        }
    }

    /**
     * Restock configured wall-side ammo shields only when out of ammo and the gate is intact.
     * Wall ammoRefill coordinates must match a skunkPowerups entry in the level data.
     */
    updateProgressionPickups(player, itemManager) {
        if (player.golfAmmo > 0) return;
        for (const wall of this.platforms) {
            if (wall.type !== 'wall' || !wall.ammoRefill) continue;
            const { x, y } = wall.ammoRefill;
            const hasPickup = itemManager.items.some(item =>
                !item.collected && item.type === 'SKUNK_POWERUP' &&
                ((item.sourceX === x && item.sourceY === y) || (item.x === x && item.baseY === y))
            );
            const hasShield = this.platforms.some(platform =>
                this.isShieldTile(platform) && platform.powerupType === 'SKUNK_POWERUP' &&
                platform.sourceX === x && platform.sourceY === y
            );
            const hasPendingDrop = this.pendingPowerupDrops.some(drop =>
                drop.powerupType === 'SKUNK_POWERUP' && drop.sourceX === x && drop.sourceY === y
            );
            if (!hasPickup && !hasShield && !hasPendingDrop) {
                this.spawnPowerupShield({ x, y }, 'SKUNK_POWERUP');
                this._staticNeedsUpdate = true;
            }
        }
    }

    spawnPowerupShield(spawn, powerupType) {
        if (!spawn || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) {
            throw new Error('Powerup shield requires finite spawn coordinates.');
        }
        const surfaces = this.platforms.filter(platform =>
            !this.isShieldTile(platform) &&
            ['static', 'moving', 'wall'].includes(platform.type) && platform.y >= 0
        );
        if (!surfaces.length) throw new Error('Powerup shield requires a supporting surface.');
        let support = surfaces.filter(platform =>
            spawn.x >= platform.x && spawn.x <= platform.x + platform.width && platform.y >= spawn.y
        ).sort((a, b) => a.y - b.y)[0];
        let centerX = spawn.x;
        if (!support) {
            const nearestCenterX = platform => platform.width < 48
                ? platform.x + platform.width / 2
                : Utils.clamp(spawn.x, platform.x + 24, platform.x + platform.width - 24);
            const distance = platform => (nearestCenterX(platform) - spawn.x) ** 2 +
                (platform.y - 49 - spawn.y) ** 2;
            support = surfaces.reduce((nearest, platform) =>
                distance(platform) < distance(nearest) ? platform : nearest
            );
            centerX = nearestCenterX(support);
        }
        const shield = {
            x: centerX - 24,
            y: support.y - 48 - 25,
            width: 48, height: 48, type: 'wall', tile: 'shield_tile',
            powerupType, sourceX: spawn.x, sourceY: spawn.y
        };
        if (support.type === 'moving') {
            shield.supportPlatform = support;
            shield.supportOffsetX = shield.x - support.x;
        }
        this.platforms.push(shield);
        return shield;
    }

    isDynamicPlatform(platform) {
        return platform.type === 'moving' || !!platform.supportPlatform;
    }

    /**
     * Check collision against platforms using previous-frame position to avoid tunneling.
     * Returns { collided: boolean, platform?: Object, landingY?: number }
     * @param {Object} rect - Current object bounding rect { x,y,width,height }
     * @param {Object} prevRect - Previous frame bounding rect
     * @param {number} velocityY - Current vertical velocity (used to skip upward movement)
     */
    checkPlatformCollision(rect, prevRect, velocityY) {
        // Optimization: Don't check if moving up
        if (velocityY < 0) return { collided: false };

        const rectBottom = rect.y + rect.height;
        const prevBottom = prevRect.y + prevRect.height;

        for (const platform of this.platforms) {
            if (platform.type === 'climb' || platform.type === 'wall' || platform.type === 'anchor') continue;

            // 1. Horizontal Overlap Check
            if (rect.x + rect.width > platform.x && rect.x < platform.x + platform.width) {
                
                // 2. Vertical "Crossed the Line" Check
                // Did we exist ABOVE the platform in the last frame?
                const previousY = platform.type === 'moving' ? platform.previousY : platform.y;
                const wasAbove = prevBottom <= previousY;
                // Are we BELOW (or ON) the platform in this frame?
                const isBelow = rectBottom >= platform.y;

                // If we crossed the threshold, it's a collision
                if (wasAbove && isBelow) {
                    return {
                        collided: true,
                        platform: platform,
                        // Snap exactly to top of platform
                        landingY: platform.y - rect.height 
                    };
                }
            }
        }
        return { collided: false };
    }

    /**
     * Resolve collisions against solid geometry (walls, blockers).
     * Unlike one-way platforms, these collide from all directions.
     * @param {Object} rect - Current object bounding rect { x,y,width,height }
     * @param {Object} prevRect - Previous frame bounding rect
     * @returns {{x:number,y:number,collidedX:boolean,collidedY:boolean,landed:boolean}}
     */
    resolveSolidCollision(rect, prevRect) {
        let outX = rect.x;
        let outY = rect.y;
        let collidedX = false;
        let collidedY = false;
        let landed = false;

        for (const platform of this.platforms) {
            if (platform.type !== 'wall') continue;
            // Pickup containers must not obstruct the routes their loose balls occupied.
            if (this.isShieldTile(platform) && platform.powerupType) continue;

            const overlaps = (
                outX < platform.x + platform.width &&
                outX + rect.width > platform.x &&
                outY < platform.y + platform.height &&
                outY + rect.height > platform.y
            );
            if (!overlaps) continue;

            const overlapLeft = outX + rect.width - platform.x;
            const overlapRight = platform.x + platform.width - outX;
            const overlapTop = outY + rect.height - platform.y;
            const overlapBottom = platform.y + platform.height - outY;
            const minOverlapX = Math.min(overlapLeft, overlapRight);
            const minOverlapY = Math.min(overlapTop, overlapBottom);

            if (minOverlapX < minOverlapY) {
                if (prevRect.x + prevRect.width <= platform.x) {
                    outX = platform.x - rect.width;
                } else if (prevRect.x >= platform.x + platform.width) {
                    outX = platform.x + platform.width;
                } else {
                    const rectCenterX = outX + rect.width * 0.5;
                    const wallCenterX = platform.x + platform.width * 0.5;
                    outX = rectCenterX < wallCenterX ? platform.x - rect.width : platform.x + platform.width;
                }
                collidedX = true;
            } else {
                if (prevRect.y + prevRect.height <= platform.y) {
                    outY = platform.y - rect.height;
                    landed = true;
                } else if (prevRect.y >= platform.y + platform.height) {
                    outY = platform.y + platform.height;
                } else {
                    const rectCenterY = outY + rect.height * 0.5;
                    const wallCenterY = platform.y + platform.height * 0.5;
                    outY = rectCenterY < wallCenterY ? platform.y - rect.height : platform.y + platform.height;
                    if (rectCenterY < wallCenterY) landed = true;
                }
                collidedY = true;
            }
        }

        return { x: outX, y: outY, collidedX, collidedY, landed };
    }

    /**
     * Find a climbable platform overlapping the given rect.
     * @param {Object} rect - Current bounding rect
     * @returns {Object|null}
     */
    getClimbableAt(rect) {
        if (!rect) return null;
        for (const platform of this.platforms) {
            if (platform.type !== 'climb') continue;
            if (rect.x + rect.width > platform.x && rect.x < platform.x + platform.width && rect.y + rect.height > platform.y && rect.y < platform.y + platform.height) {
                return platform;
            }
        }
        return null;
    }

    /**
     * Find a wall overlapping the given rect (solid geometry probe).
     * @param {Object} rect
     * @returns {Object|null}
     */
    getWallAt(rect) {
        if (!rect) return null;
        for (const platform of this.platforms) {
            if (platform.type !== 'wall') continue;
            if (rect.x + rect.width > platform.x && rect.x < platform.x + platform.width && rect.y + rect.height > platform.y && rect.y < platform.y + platform.height) {
                return platform;
            }
        }
        return null;
    }

    getAnchorAt(rect) {
        if (!rect) return null;
        for (const platform of this.platforms) {
            if (platform.type !== 'anchor') continue;
            const padding = 8;
            if (
                rect.x + rect.width > platform.x - padding &&
                rect.x < platform.x + platform.width + padding &&
                rect.y + rect.height > platform.y - padding &&
                rect.y < platform.y + platform.height + padding
            ) {
                return platform;
            }
        }
        return null;
    }

    isShieldTile(platform) {
        return platform.tile === 'shield_tile' && platform.material !== 'solid' &&
            (platform.type === 'static' || platform.type === 'wall');
    }

    getShieldTileAt(rect) {
        return this.platforms.find(platform =>
            this.isShieldTile(platform) && Utils.rectCollision(rect, platform)
        ) || null;
    }

    getWallMaterial(wall) {
        if (wall.material === 'solid') return 'solid';
        if (this.isShieldTile(wall)) return 'shield';
        const tileMaterials = { wall_tile_fire: 'vine', wall_tile_bomb: 'rock', wall_tile_shock: 'shock' };
        return tileMaterials[wall.tile] || wall.material || 'solid';
    }

    hitWall(wall, shotType) {
        if (!wall || (wall.type !== 'wall' && !this.isShieldTile(wall))) return { destroyed: false, material: null };
        const material = this.getWallMaterial(wall);
        const destroysWall = material === 'shield' || (material === 'vine' && shotType === 'fireball') ||
            (material === 'rock' && shotType === 'bomb') ||
            (material === 'shock' && shotType === 'gold');
        if (!destroysWall) return { destroyed: false, material };

        const wallIndex = this.platforms.indexOf(wall);
        if (wallIndex < 0) return { destroyed: false, material };
        this.platforms.splice(wallIndex, 1);

        // Remove a climbable attached to the destroyed barrier so no visual remnant floats in place.
        this.platforms = this.platforms.filter((platform) => {
            if (material === 'shield') return true;
            if (platform.type !== 'climb') return true;
            const verticalOverlap = platform.y < wall.y + wall.height && platform.y + platform.height > wall.y;
            const horizontalGap = Math.max(0, wall.x - (platform.x + platform.width), platform.x - (wall.x + wall.width));
            return !(verticalOverlap && horizontalGap <= 12);
        });
        this._staticNeedsUpdate = true;
        if (typeof document !== 'undefined' && typeof this.renderStaticLayer === 'function') {
            this.renderStaticLayer();
        }
        const result = { destroyed: true, material, x: wall.x + wall.width / 2, y: wall.y + wall.height / 2 };
        if (material === 'shield') {
            this.pendingPowerupDrops.push({
                x: result.x, y: result.y, powerupType: wall.powerupType,
                sourceX: wall.sourceX, sourceY: wall.sourceY
            });
        }
        return result;
    }

    /**
     * Render the level: background layers, static layer, moving platforms.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} [cameraX=0]
     * @param {number} [cameraY=0]
     * @param {number|null} [viewWidth=null]
     * @param {number|null} [viewHeight=null]
     */
    draw(ctx, cameraX = 0, cameraY = 0, viewWidth = null, viewHeight = null) {
        // 1. Draw Background (screen-space): panorama if available, otherwise gradient.
        // Important: background should fill the viewport (0..w,0..h) regardless of camera.
        const w = viewWidth || this.width || ctx.canvas.width;
        const h = viewHeight || this.height || ctx.canvas.height;

        // Mobile performance tuning: allow the same draw path, but optionally
        // disable heavy background images on very low-end devices.
        let mobilePerfMode = null;
        try { mobilePerfMode = (typeof localStorage !== 'undefined') ? localStorage.getItem('mobilePerfMode') : null; } catch (e) { __err('level', e); }
        const allowBackgroundImage = !(this.useMobileOptimizations && mobilePerfMode === 'low');

        let bgImg = null;
        // Always attempt to draw the main background image when available
        // unless explicitly disabled by low-end mobile perf mode.
        if (allowBackgroundImage) {
            try {
                if (!this.cachedSprites[this.backgroundName]) {
                    this.cachedSprites[this.backgroundName] = (typeof spriteLoader !== 'undefined') ? spriteLoader.getSprite(this.backgroundName) : null;
                }
                bgImg = this.cachedSprites[this.backgroundName];
            } catch (e) { bgImg = null; }
        }

        // Main background first (farthest layer)
        if (bgImg) {
            try {
                const scaleY = h / bgImg.height;
                const tileW = Math.max(1, Math.ceil(bgImg.width * scaleY));
                const parallax = (typeof this.backgroundParallax !== 'undefined') ? this.backgroundParallax : (typeof Config !== 'undefined' ? Config.BACKGROUND_PARALLAX : 0.5);
                const repeatCount = Math.ceil(w / tileW) + 2;
                const startX = Math.floor(-((cameraX * parallax) % tileW));
                for (let i = 0; i < repeatCount; i++) {
                    const dx = startX + i * tileW;
                    ctx.drawImage(bgImg, 0, 0, bgImg.width, bgImg.height, dx, 0, tileW, h);
                }
            } catch (e) {
                bgImg = null;
            }
        }

        // Fallback gradient if background image isn't available
        if (!bgImg) {
            // Recreate gradient if viewport height changes
            if (!this.backgroundGradient || this._backgroundGradientH !== h) {
                this._backgroundGradientH = h;
                this.backgroundGradient = ctx.createLinearGradient(0, 0, 0, h);
                this.backgroundGradient.addColorStop(0, this.theme.bgTop);
                this.backgroundGradient.addColorStop(0.5, this.theme.bgMid);
                this.backgroundGradient.addColorStop(1, this.theme.bgBot);
            }
            ctx.fillStyle = this.backgroundGradient;
            ctx.fillRect(0, 0, w, h);

            // Draw a row of stylized trees at the bottom for the 'forest' theme
            if (this.backgroundName && this.backgroundName.includes('forest')) {
                const treeHeight = 120; // Increased from 60
                const treeWidth = 100;  // Increased from 50
                const treeSpacing = 80; // Increased from 40
                const groundY = h - 30;
                ctx.fillStyle = '#0b3d1e'; // Dark green for trees

                const treeCount = Math.ceil(w / treeSpacing) + 2;
                const startX = -((cameraX * 0.1) % treeSpacing);

                for (let i = 0; i < treeCount; i++) {
                    const x = startX + i * treeSpacing;
                    ctx.beginPath();
                    ctx.moveTo(x, groundY);
                    ctx.lineTo(x + treeWidth / 2, groundY - treeHeight);
                    ctx.lineTo(x + treeWidth, groundY);
                    ctx.closePath();
                    ctx.fill();
                }
            }
        }

        // Background layers (drawn on top of main background for depth)
        if (!this.useMobileOptimizations) {
            for (const layer of this.backgroundLayers) {
                let layerImg = null;
                try {
                    if (!layer || !layer.name) continue;
                    if (!this.cachedSprites[layer.name]) {
                        this.cachedSprites[layer.name] = (typeof spriteLoader !== 'undefined') ? spriteLoader.getSprite(layer.name) : null;
                    }
                    layerImg = this.cachedSprites[layer.name];
                } catch (e) { layerImg = null; }
                if (!layerImg) continue;

                try {
                    const scaleY = h / layerImg.height;
                    const tileW = Math.max(1, Math.ceil(layerImg.width * scaleY));
                    const parallax = (typeof layer.parallax === 'number') ? layer.parallax : 0.5;
                    const repeatCount = Math.ceil(w / tileW) + 2;
                    const startX = Math.floor(-((cameraX * parallax) % tileW));
                    for (let i = 0; i < repeatCount; i++) {
                        const dx = startX + i * tileW;
                        ctx.drawImage(layerImg, 0, 0, layerImg.width, layerImg.height, dx, 0, tileW, h);
                    }
                } catch (e) { __err('level', e); }
            }
        }

        ctx.save();
        ctx.translate(-cameraX, -cameraY);

        // 2. Draw Platforms — use pre-rendered static layer for non-moving
        // platforms to speed up rendering on low-end devices.
        if (this._staticLayerCanvas && !this._staticNeedsUpdate) {
            try {
                ctx.imageSmoothingEnabled = false;
                // Draw entire static layer stretched to the level size.
                ctx.drawImage(this._staticLayerCanvas, 0, 0, this._staticLayerCanvas.width, this._staticLayerCanvas.height, 0, 0, this.width, this.height);
            } catch (e) {
                // fallback to per-platform draw
                for (const platform of this.platforms) {
                    if (!this.isDynamicPlatform(platform)) this.drawPlatform(ctx, platform);
                }
            }
        } else {
            for (const platform of this.platforms) {
                if (!this.isDynamicPlatform(platform)) this.drawPlatform(ctx, platform);
            }
        }

        // Always draw moving platforms on top
        for (const platform of this.platforms) {
            if (this.isDynamicPlatform(platform)) this.drawPlatform(ctx, platform);
        }

        // 3. Hazards are not supported in this build; legacy hazard data is ignored.

        ctx.restore();
    }

    constructor(width = 800, height = 600) {
        this.width = width;
        this.height = height;
        this.platforms = [];
        this._motionTime = 0;
        this.pendingPowerupDrops = [];

        // Level visuals & content
        this.backgroundName = 'bg_city';
        this.backgroundLayers = [];
        this.backgroundParallax = (typeof Config !== 'undefined' ? Config.BACKGROUND_PARALLAX : 0.5);
        this.spawnPoints = null;
        this.hazards = [];

        this.backgroundGradient = null;
        this.tileMode = 'tiles'; // 'tiles' or 'neon' - controls platform rendering
        this._tilePatterns = {}; // reserved for future per-canvas pattern caching
        this.cachedSprites = {}; // cache for sprite images

        // Static layer caching for pre-rendered non-moving platforms
        this._staticNeedsUpdate = true;
        this._staticLayerCanvas = null;
        this._staticLayerScale = 1;

        // Performance flags
        this.useMobileOptimizations = false;

        // Cyberpunk style config
        this.theme = {
            // Default/fallback background: light pastel green gradient
            // (used when no panorama is available or when low-end mobile perf mode disables it)
            bgTop: '#eefaf0',
            bgMid: '#d6f3da',
            bgBot: '#bfecc6',
            platTop: '#00fff7',    // Neon cyan
            platBot: '#ff00ea',    // Neon magenta
            border: '#fffb00',     // Bright yellow border
            glow: '#00fff7',       // Neon cyan glow
        };
    }

    /**
     * Load and cache a sprite by name using the global spriteLoader.
     * Returns null if the sprite isn't available.
     * @param {string} name
     * @returns {HTMLImageElement|null}
     */
    _getSprite(name) {
        if (!name) return null;
        if (!this.cachedSprites[name]) {
            try {
                this.cachedSprites[name] = (typeof spriteLoader !== 'undefined') ? spriteLoader.getSprite(name) : null;
            } catch (e) {
                this.cachedSprites[name] = null;
                if (typeof console !== 'undefined' && console.warn) console.warn(`Failed to load sprite ${name}`, e);
            }
        }
        return this.cachedSprites[name];
    }

    /**
     * Create a repeating CanvasPattern for the given tile on the provided context.
     * Returns null on failure.
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} tileName
     * @returns {CanvasPattern|null}
     */
    _createPattern(ctx, tileName) {
        if (!ctx || !tileName) return null;
        const tileImg = this._getSprite(tileName);
        if (!tileImg) return null;
        try {
            return ctx.createPattern(tileImg, 'repeat');
        } catch (e) {
            if (typeof console !== 'undefined' && console.warn) console.warn(`Failed to create pattern for ${tileName}`, e);
            return null;
        }
    }

    drawPlatform(ctx, p) {
        if (this.isShieldTile(p)) {
            this.drawShieldTile(ctx, p);
            return;
        }
        if (p.type === 'anchor') {
            this.drawHookshotAnchor(ctx, p);
            return;
        }

        if (p.type === 'climb') {
            this.drawClimbable(ctx, p);
            return;
        }

        if (p.type === 'wall') {
            this.drawDestructibleWall(ctx, p);
            return;
        }

        // If tile mode is enabled and sprite exists, draw a tiled fill
        if (this.tileMode === 'tiles') {
            const tileName = p.tile || 'platform_tile';
            const pattern = this._createPattern(ctx, tileName);
            if (pattern) {
                ctx.save();
                ctx.fillStyle = pattern;
                ctx.fillRect(p.x, p.y, p.width, p.height);
                ctx.restore();

                // Subtle border and highlight for readability
                ctx.save();
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.lineWidth = 2;
                ctx.strokeRect(p.x, p.y, p.width, p.height);
                ctx.globalAlpha = 0.25;
                ctx.fillStyle = '#fff';
                ctx.fillRect(p.x, p.y, p.width, 4);
                ctx.restore();

                return; // done
            }
        }

            // Fallback: dark blue tile style
            const fallbackTop = '#0b1f3b';
            const fallbackBot = '#07162d';
            const fallbackBorder = '#123464';
            const fallbackHighlight = 'rgba(255,255,255,0.08)';

           // Dark blue gradient fill
           const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.height);
           grad.addColorStop(0, fallbackTop);
           grad.addColorStop(1, fallbackBot);
           ctx.fillStyle = grad;
           ctx.fillRect(p.x, p.y, p.width, p.height);

           // Subtle border
           ctx.save();
           ctx.strokeStyle = fallbackBorder;
           ctx.lineWidth = 2;
           ctx.strokeRect(p.x, p.y, p.width, p.height);
           ctx.restore();

           // Soft highlight strip
           ctx.save();
           ctx.fillStyle = fallbackHighlight;
           ctx.fillRect(p.x, p.y, p.width, 4);
           ctx.restore();
    }

    drawShieldTile(ctx, tile) {
        const sprite = this._getSprite('shield_tile');
        if (sprite) {
            ctx.drawImage(sprite, tile.x, tile.y, tile.width, tile.height);
        } else {
            ctx.save();
            ctx.fillStyle = '#4169D8';
            ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
            ctx.strokeStyle = '#FFD54A';
            ctx.lineWidth = 2;
            ctx.strokeRect(tile.x, tile.y, tile.width, tile.height);
            ctx.restore();
        }
    }

    drawDestructibleWall(ctx, wall, tileScaleX = 1, tileScaleY = 1) {
        const material = this.getWallMaterial(wall);
        const wallTiles = { vine: 'wall_tile_fire', rock: 'wall_tile_bomb', shock: 'wall_tile_shock' };
        const tileName = material === 'solid' ? 'wall_tile' : (wallTiles[material] || wall.tile || 'wall_tile');
        const pattern = this.tileMode === 'tiles' ? this._createPattern(ctx, tileName) : null;
        ctx.save();
        // Cache coordinates are compressed; retain world-space tiles and borders.
        ctx.translate(wall.x, wall.y);
        ctx.scale(tileScaleX, tileScaleY);
        wall = { ...wall, x: 0, y: 0, width: wall.width / tileScaleX, height: wall.height / tileScaleY };
        if (pattern) {
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, wall.width, wall.height);
        } else if (material === 'vine') {
            const wallGradient = ctx.createLinearGradient(wall.x, wall.y, wall.x + wall.width, wall.y);
            wallGradient.addColorStop(0, '#123C20');
            wallGradient.addColorStop(0.5, '#267A34');
            wallGradient.addColorStop(1, '#0C2D18');
            ctx.fillStyle = wallGradient;
            ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
            ctx.strokeStyle = '#62D66F';
            ctx.lineWidth = 4;
            for (let y = wall.y + 12; y < wall.y + wall.height; y += 28) {
                ctx.beginPath();
                ctx.moveTo(wall.x + 8, y);
                ctx.bezierCurveTo(wall.x + wall.width * 0.8, y + 8, wall.x + wall.width * 0.2, y + 20, wall.x + wall.width - 8, y + 26);
                ctx.stroke();
            }
            ctx.fillStyle = '#FFB11B';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('🔥', wall.x + wall.width / 2, wall.y + 26);
        } else if (material === 'shock') {
            ctx.fillStyle = '#233B96';
            ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
            ctx.fillStyle = '#FFD54A';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('⚡', wall.x + wall.width / 2, wall.y + 26);
        } else {
            const stoneGradient = ctx.createLinearGradient(wall.x, wall.y, wall.x, wall.y + wall.height);
            stoneGradient.addColorStop(0, '#747A80');
            stoneGradient.addColorStop(1, '#30353A');
            ctx.fillStyle = stoneGradient;
            ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
            ctx.strokeStyle = '#1D2023';
            ctx.lineWidth = 3;
            for (let y = wall.y + 32; y < wall.y + wall.height; y += 34) {
                ctx.beginPath();
                ctx.moveTo(wall.x, y);
                ctx.lineTo(wall.x + wall.width, y);
                ctx.stroke();
            }
            if (material === 'rock') {
                ctx.fillStyle = '#FF9B32';
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('💣', wall.x + wall.width / 2, wall.y + 26);
            }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
        ctx.restore();
    }

    drawHookshotAnchor(ctx, anchor) {
        const centerX = anchor.x + anchor.width / 2;
        const centerY = anchor.y + anchor.height / 2;
        const radius = Math.max(8, Math.min(anchor.width, anchor.height) * 0.34);
        ctx.save();
        ctx.shadowColor = '#7DE3FF';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#17242C';
        ctx.strokeStyle = '#D9F7FF';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#7B8A93';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY + radius);
        ctx.lineTo(centerX, anchor.y + anchor.height);
        ctx.stroke();
        ctx.fillStyle = '#7DE3FF';
        ctx.font = `bold ${Math.max(10, radius)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚓', centerX, centerY + 1);
        ctx.restore();
    }

    drawClimbable(ctx, p) {
        const style = p.style || (p.tile && p.tile.includes('vine') ? 'vine' : 'ladder');
        if (style === 'vine') {
            const stemX = p.x + p.width * 0.45;
            const stemW = Math.max(4, p.width * 0.18);
            const leafCount = Math.max(4, Math.floor(p.height / 36));
            ctx.save();
            const stemGrad = ctx.createLinearGradient(p.x, p.y, p.x + p.width, p.y + p.height);
            stemGrad.addColorStop(0, '#1f7a2a');
            stemGrad.addColorStop(1, '#0d4f16');
            ctx.fillStyle = stemGrad;
            ctx.fillRect(stemX, p.y, stemW, p.height);
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = 2;
            ctx.strokeRect(stemX, p.y, stemW, p.height);
            for (let i = 0; i < leafCount; i++) {
                const y = p.y + (i + 0.5) * (p.height / leafCount);
                const side = i % 2 === 0 ? -1 : 1;
                ctx.beginPath();
                ctx.fillStyle = side < 0 ? '#2aa03b' : '#55c96a';
                ctx.ellipse(stemX + stemW / 2 + side * p.width * 0.18, y, p.width * 0.16, p.height / (leafCount * 2.3), side * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            return;
        }

        const railW = Math.max(4, Math.floor(p.width * 0.16));
        const rungCount = Math.max(3, Math.floor(p.height / 26));
        ctx.save();
        ctx.fillStyle = '#7b4b21';
        ctx.fillRect(p.x, p.y, railW, p.height);
        ctx.fillRect(p.x + p.width - railW, p.y, railW, p.height);
        ctx.fillStyle = '#b07b45';
        ctx.fillRect(p.x + railW, p.y, p.width - railW * 2, 4);
        ctx.fillStyle = '#c9a16f';
        for (let i = 1; i < rungCount; i++) {
            const y = p.y + (i * p.height) / rungCount;
            ctx.fillRect(p.x + railW, y, p.width - railW * 2, 3);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, p.width, p.height);
        ctx.restore();
    }

    // ----- Static layer pre-rendering for non-moving platforms -----
    // Call when level content or viewport size changes
    renderStaticLayer(viewWidth = null, viewHeight = null) {
        try {
            // Cap pre-rendered static layer width to avoid excessive memory
            // and GPU texture usage. Use a smaller cap on mobile to reduce
            // pressure on devices like iPad/Safari.
            const MAX_STATIC_WIDTH = this.useMobileOptimizations ? 2048 : 4096;
            const targetW = Math.min(this.width, MAX_STATIC_WIDTH);
            // We'll render at the level height so vertical content is preserved
            const targetH = Math.max(1, Math.floor(this.height));

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(targetW));
            canvas.height = Math.max(1, Math.floor(targetH));
            const c = canvas.getContext('2d');
            c.imageSmoothingEnabled = false;

            // Clear
            c.fillStyle = 'rgba(0,0,0,0)';
            c.fillRect(0, 0, canvas.width, canvas.height);

            // Draw static (non-moving) platforms into the static canvas
            for (const p of this.platforms) {
                if (this.isDynamicPlatform(p)) continue;

                const sx = Math.floor((p.x / this.width) * canvas.width);
                const sy = Math.floor((p.y / this.height) * canvas.height);
                const sw = Math.max(1, Math.floor((p.width / this.width) * canvas.width));
                const sh = Math.max(1, Math.floor((p.height / this.height) * canvas.height));
                const scaled = { ...p, x: sx, y: sy, width: sw, height: sh };

                if (this.isShieldTile(p)) {
                    this.drawShieldTile(c, scaled);
                    continue;
                }

                if (p.type === 'anchor') {
                    this.drawHookshotAnchor(c, scaled);
                    continue;
                }

                if (p.type === 'climb') {
                    this.drawClimbable(c, scaled);
                    continue;
                }

                if (p.type === 'wall') {
                    this.drawDestructibleWall(c, scaled, canvas.width / this.width, canvas.height / this.height);
                    continue;
                }

                // If tile mode with a pattern, create pattern on the static ctx
                if (this.tileMode === 'tiles') {
                    const tileName = p.tile || 'platform_tile';
                    const pattern = this._createPattern(c, tileName);
                    if (pattern) {
                        c.save();
                        c.fillStyle = pattern;
                        c.fillRect(sx, sy, sw, sh);
                        c.restore();
                        // subtle border
                        c.save(); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 2; c.strokeRect(sx, sy, sw, sh); c.restore();
                        continue;
                    }
                }

                // Fallback dark blue tile style
                c.save();
                const grad = c.createLinearGradient(sx, sy, sx, sy + sh);
                grad.addColorStop(0, '#0b1f3b');
                grad.addColorStop(1, '#07162d');
                c.fillStyle = grad;
                c.fillRect(sx, sy, sw, sh);
                c.strokeStyle = '#123464';
                c.lineWidth = 2;
                c.strokeRect(sx, sy, sw, sh);
                c.restore();
            }

            this._staticLayerCanvas = canvas;
            this._staticLayerScale = canvas.width / this.width;
            this._staticNeedsUpdate = false;
        } catch (e) {
            this._staticLayerCanvas = null;
            this._staticNeedsUpdate = true;
            console.warn('renderStaticLayer failed', e);
        }
    }
}