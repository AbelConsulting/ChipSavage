/*!
 * Chip Savage
 * Copyright (c) 2026 Mephitideus Interactive. All Rights Reserved.
 * Proprietary and confidential — unauthorized copying, distribution, or use
 * of this file, via any medium, is strictly prohibited. See LICENSE for terms.
 */
/**
 * Player character class
 */

class Player {
    constructor(x, y, audioManager) {
        // Position and movement
        this.x = x;
        this.y = y;
        this.audioManager = audioManager;
        this.width = 64;
        this.height = 64;

        // Character stats (Chip Savage)
        this.name = Config.CHARACTER.name;
        this.maxHealth = Config.CHARACTER.health;
        this.health = this.maxHealth;
        this.speed = Config.CHARACTER.speed;
        this.jumpForce = Config.CHARACTER.jump_force;
        this.attackDamage = Config.CHARACTER.attack_damage;
        this.specialAbility = Config.CHARACTER.special_ability;
        this.color = Config.CHARACTER.color;

        // Load sprites
        this.loadSprites();

        // Movement state
        this.velocityX = 0;
        this.velocityY = 0;
        this.targetVelocityX = 0;
        this.acceleration = 2500;
        this.friction = 1800;
        this.facingRight = true;
        this.onGround = false;
        this.isClimbing = false;
        this._climbable = null;
        this.climbSpeed = (Config && Config.CLIMB_SPEED) || 260;

        // Jump mechanics
        this.coyoteTime = 0.15;
        this.coyoteTimer = 0;
        this.jumpBufferTime = 0.2;
        this.jumpBufferTimer = 0;
        this.jumpBufferCount = 0;
        this.maxJumps = 2;
        this.jumpsRemaining = this.maxJumps;

        // Combat state
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackDuration = 0.3;
        this.attackCooldown = 0.3;
        this.attackCooldownTimer = 0;
        this.defaultAttackWidth = 108;
        this.defaultAttackHeight = 40;
        this.attackHitbox = { x: 0, y: 0, width: this.defaultAttackWidth, height: this.defaultAttackHeight };
        this.hitEnemies = new Set();

        // Track previous-frame attack hitbox (used for swept collision checks)
        this._prevAttackHitbox = null;

        // Kick state
        this.isKicking = false;
        // Keep the move duration in sync with the animation timing.
        // Kick should have enough active frames to feel consistent.
        const kickAnim = this.animations && this.animations.kick;
        this.kickDuration = kickAnim ? (kickAnim.frameCount * kickAnim.frameDuration) : 0.4;
        // Tune dash distance (speed * duration). With 4 frames @ 0.08s => 0.32s total.
        this.kickSpeed = 380;

        // Golf Shot animation state (character-only, not projectile)
        this.isGolfShooting = false;
        const golfShotAnim = this.animations && this.animations.golf_shot;
        this.golfShotDuration = golfShotAnim ? (golfShotAnim.frameCount * golfShotAnim.frameDuration) : 0.32;
        this.golfShotTimer = 0;

        // Kick tuning: active damage window and hitbox size
        // Default: active on all frames except the first/last (windup/recovery)
        this.kickHitboxWidth = 108;
        this.kickHitboxHeight = 68;

        // Combo system
        this.comboCount = 0;
        this.comboWindow = (Config.COMBO && Config.COMBO.COMBO_WINDOW) || 2.0;
        this.comboTimer = 0;
        this.maxCombo = (Config.COMBO && Config.COMBO.MAX_COMBO) || 99;
        this._lastComboTier = 0; // Track tier for milestone events
        this._multiHitCount = 0; // Enemies hit in current attack

        // Hit feedback
        this.hitStunTimer = 0;
        this.invulnerableTimer = 0;
        this.invulnerableDuration = 1.0; // 1 second i-frames after being hit

        // Death animation state
        this.isDying = false;
        this.deathTimer = 0;
        this.deathDuration = 1.8;

        // Footstep sounds
        this.footstepTimer = 0;
        this.footstepInterval = 0.25; // Footstep every 0.25 seconds when walking

        // Health regeneration effect (applied by health regen pickups)
        this.healthRegen = null;

        // Speed boost effect (applied by speed boost pickups)
        this.speedBoost = null;
        
        // Damage boost effect (applied by damage boost pickups)
        this.damageBoost = null;
        
        // Skunk projectile system
        this.golfAmmo = 0; // Number of Golf Shots available
        this.golfProjectiles = []; // Active skunk projectiles
        this.golfSprays = []; // Active spray clouds (AoE on impact)
        this.golfCooldown = 0.5; // Cooldown between Golf Shots
        this.golfCooldownTimer = 0;
        this.golfShotTypes = ['gold', 'fireball', 'hookshot', 'fishing', 'bomb'];
        this.selectedGolfShotIndex = 0;
        
        // Idol collection bonuses (tiered, per-level)
        // { speed: 0.05, damage: 0.05, count: 1 } - tiers by collected count
        this.idolBonuses = null;
        
        // Visual effects
        this.speedTrailEffect = new SpeedTrailEffect();
        this.healthRegenEffect = new HealthRegenEffect();
        this.damageBoostEffect = new DamageBoostEffect();

        // Animation state
        this.animationState = "IDLE";
        this.currentAnimation = null;

        // Input
        this.keys = {};

        // Attack stats hooks (consumed by Game for accuracy tracking)
        this._attackJustStarted = false;
        this._attackDidHit = false;
    }

    loadSprites() {
        const chip_idle = spriteLoader.getSprite('chip_idle');
        const chip_walk = spriteLoader.getSprite('chip_walk');
        const chip_jump = spriteLoader.getSprite('chip_jump');
        const chip_climb = spriteLoader.getSprite('chip_climb');
        const chip_attack = spriteLoader.getSprite('chip_attack');
        const chip_golf_shot = spriteLoader.getSprite('chip_golf_shot');
        const chip_kick = spriteLoader.getSprite('chip_kick');
        const chip_hurt = spriteLoader.getSprite('chip_hurt');
        const chip_death = spriteLoader.getSprite('chip_death');

        // Use spriteLoader.createAnimation when available so frameStride can be
        // inferred from sheet dimensions (handles padding between frames).
        if (spriteLoader && typeof spriteLoader.createAnimation === 'function') {
            // Let the SpriteLoader infer frame width/stride (it can detect
            // per-sheet padding) instead of forcing a hardcoded value.
            this.animations = {
                idle: spriteLoader.createAnimation('chip_idle', 4, 0.15),
                walk: spriteLoader.createAnimation('chip_walk', 4, 0.1),
                jump: spriteLoader.createAnimation('chip_jump', 4, 0.12),
                climb: spriteLoader.createAnimation('chip_climb', 4, 0.12),
                attack: spriteLoader.createAnimation('chip_attack', 4, 0.08),
                golf_shot: spriteLoader.createAnimation('chip_golf_shot', 4, 0.08),
                // Kick: 4 frames, snappy timing.
                // Note: the current sheet is 256x64 (4x 64px frames) so we let
                // SpriteLoader infer correct slicing.
                kick: spriteLoader.createAnimation('chip_kick', 4, 0.06),
                hurt: spriteLoader.createAnimation('chip_hurt', 2, 0.1),
                death: spriteLoader.createAnimation('chip_death', 4, 0.37)
            };
        } else {
            this.animations = {
                idle: new Animation(chip_idle, 4, 0.15, { frameWidth: 64, frameHeight: 64, frameStride: 65 }),
                walk: new Animation(chip_walk, 4, 0.1, { frameWidth: 64, frameHeight: 64, frameStride: 65 }),
                jump: new Animation(chip_jump, 4, 0.12, { frameWidth: 64, frameHeight: 64, frameStride: 65 }),
                climb: new Animation(chip_climb, 4, 0.12, { frameWidth: 64, frameHeight: 64, frameStride: 65 }),
                attack: new Animation(chip_attack, 4, 0.08, { frameWidth: 64, frameHeight: 64, frameStride: 65 }),
                golf_shot: new Animation(chip_golf_shot, 4, 0.08, { frameWidth: 64, frameHeight: 64, frameStride: 64, frameOffset: 0 }),
                kick: new Animation(chip_kick, 4, 0.06, { frameWidth: 64, frameHeight: 64, frameStride: 64, frameOffset: 0 }),
                hurt: new Animation(chip_hurt, 2, 0.1, { frameWidth: 64, frameHeight: 64, frameStride: 65 }),
                death: new Animation(chip_death, 4, 0.37, { frameWidth: 64, frameHeight: 64, frameStride: 65 })
            };
        }

        this.currentAnimation = this.animations.idle;

        // If sprites aren't loaded yet, defer retry until spriteLoader finishes
        if ((!this.currentAnimation || !this.currentAnimation.spriteSheet) &&
            spriteLoader && typeof spriteLoader.whenReady === 'function' && !spriteLoader._ready) {
            spriteLoader.whenReady(() => this.loadSprites());
        }
    }

    handleInput(key, isDown) {
        // Normalize key (accept both event.code and event.key forms)
        const k = (key || '').toString().toLowerCase();
        const wasDown = !!this.keys[k];
        this.keys[k] = isDown;

        if (isDown && !wasDown) {
            if (k === 'space' || k === 'spacebar' || k === ' ') {
                if (this.isClimbing) {
                    this.jump();
                } else {
                    this.jumpBufferTimer = this.jumpBufferTime;
                    this.jumpBufferCount = Math.min(this.jumpBufferCount + 1, this.maxJumps);
                }
            } else if (k === 'keyx' || k === 'x') {
                this.attack();
            } else if (k === 'keyz' || k === 'z') {
                this.specialAttack();
            } else if (k === 'keyc' || k === 'c') {
                this.shootGolfProjectile();
            } else if (k === 'keyv' || k === 'v') {
                this.cycleGolfShot();
            }
        }
    }

    getSelectedGolfShot() {
        return this.golfShotTypes[this.selectedGolfShotIndex] || 'gold';
    }

    cycleGolfShot(direction = 1) {
        const count = this.golfShotTypes.length;
        this.selectedGolfShotIndex = (this.selectedGolfShotIndex + direction + count) % count;
        return this.getSelectedGolfShot();
    }

    jump() {
        if (this.hitStunTimer > 0) return;

        if (this.isClimbing) {
            this.isClimbing = false;
            this._climbable = null;
            this.velocityY = -this.jumpForce;
            this.coyoteTimer = 0;
            this.jumpsRemaining = Math.max(0, this.maxJumps - 1);
            if (this.audioManager) {
                const rate = 0.97 + Math.random() * 0.08;
                this.audioManager.playSound('jump', { volume: 0.6, rate });
            }
            return;
        }

        const canGroundJump = this.onGround || this.coyoteTimer > 0;
        const canAirJump = !canGroundJump && this.jumpsRemaining > 0;

        if (canGroundJump || canAirJump) {
            this.velocityY = -this.jumpForce;
            this.coyoteTimer = 0;
            if (canGroundJump) {
                this.jumpsRemaining = Math.max(0, this.maxJumps - 1);
            } else {
                this.jumpsRemaining = Math.max(0, this.jumpsRemaining - 1);
            }
            if (this.audioManager) {
                if (canAirJump) {
                    // Air jump gets its own sound — higher pitched, lighter
                    const rate = 1.0 + Math.random() * 0.1;
                    this.audioManager.playSound('double_jump', { volume: 0.55, rate });
                } else {
                    const rate = 0.97 + Math.random() * 0.08;
                    this.audioManager.playSound('jump', { volume: 0.6, rate });
                }
            }
        }
    }

    _startClimbing(climbable) {
        if (!climbable) return;
        this.isClimbing = true;
        this._climbable = climbable;
        this.velocityX = 0;
        this.velocityY = 0;
        this.targetVelocityX = 0;
        this.onGround = false;
        this.coyoteTimer = 0;
        this.jumpsRemaining = this.maxJumps;
        this.x = climbable.x + (climbable.width - this.width) / 2;
    }

    _stopClimbing() {
        this.isClimbing = false;
        this._climbable = null;
    }

    attack() {
        if (this.isClimbing) return;
        if (this.attackCooldownTimer <= 0 && this.hitStunTimer <= 0) {
            this.isAttacking = true;
            this.isKicking = false;
            this.attackTimer = this.attackDuration;
            this.attackCooldownTimer = this.attackCooldown;
            this.hitEnemies.clear();

            // Mark attack start for Game stats (count once per attack)
            this._attackJustStarted = true;
            this._attackDidHit = false;

            // Ensure hitbox is positioned immediately (not one frame later)
            this.attackHitbox.width = this.defaultAttackWidth;
            this.attackHitbox.height = this.defaultAttackHeight;
            this._updateAttackHitboxPosition();

            // Reset multi-hit tracker for new attack
            this._multiHitCount = 0;

            // Play attack sound
            if (this.audioManager) {
                const sounds = ['attack1', 'attack2', 'attack3'];
                const sound = sounds[(this.comboCount - 1) % 3];
                this.audioManager.playSound(sound, 0.7);
            }

            // Reset attack animation
            if (this.animations.attack) {
                this.animations.attack.reset();
            }
        }
    }

    shootGolfProjectile() {
        if (this.isClimbing) return;
        // Check if player has skunk ammo and cooldown is ready
        if (this.golfAmmo > 0 && this.golfCooldownTimer <= 0 && this.hitStunTimer <= 0) {
            const shotType = this.getSelectedGolfShot();
            const shotConfig = {
                gold: { speed: 600, lift: -50, gravityScale: 0.15, size: 24, lifetime: 2.0 },
                fireball: { speed: 720, lift: -20, gravityScale: 0.04, size: 28, lifetime: 1.8 },
                hookshot: { speed: 850, lift: 0, gravityScale: 0, size: 20, lifetime: 1.3 },
                fishing: { speed: 560, lift: -140, gravityScale: 0.3, size: 20, lifetime: 2.3 },
                bomb: { speed: 470, lift: -250, gravityScale: 0.55, size: 30, lifetime: 2.5 }
            }[shotType];
            this.golfAmmo--;
            this.golfCooldownTimer = this.golfCooldown;
            this._golfShotJustFired = true; // Flag for gameStats tracking

            this.isGolfShooting = true;
            this.golfShotTimer = this.golfShotDuration;
            if (this.animations.golf_shot) {
                this.animations.golf_shot.reset();
            }
            
            // Create projectile
            const projectile = {
                x: this.x + (this.facingRight ? this.width : 0),
                y: this.y + this.height / 2,
                width: shotConfig.size,
                height: shotConfig.size,
                velocityX: (this.facingRight ? shotConfig.speed : -shotConfig.speed),
                velocityY: shotConfig.lift,
                facingRight: this.facingRight,
                shotType,
                gravityScale: shotConfig.gravityScale,
                lifetime: shotConfig.lifetime,
                age: 0
            };
            
            this.golfProjectiles.push(projectile);
            
            // Play Golf Shot sound
            if (this.audioManager) {
                this.audioManager.playSound('golf_shot', { volume: 0.7, rate: 1.1 });
            }
        }
    }

    specialAttack() {
        if (this.isClimbing) return;
        if (this.attackCooldownTimer <= 0 && this.hitStunTimer <= 0) {
            this.isAttacking = true;
            this.isKicking = true;
            this.attackTimer = this.kickDuration;
            this.attackCooldownTimer = this.attackCooldown * 1.5;
            this.hitEnemies.clear();

            // Mark attack start for Game stats (count once per attack)
            this._attackJustStarted = true;
            this._attackDidHit = false;

            // Enhanced hitbox for Kick
            this.attackHitbox.width = this.kickHitboxWidth;
            this.attackHitbox.height = this.kickHitboxHeight;
            this._updateAttackHitboxPosition();

            // Dash forward
            this.velocityX = this.facingRight ? this.kickSpeed : -this.kickSpeed;

            if (this.audioManager) {
                this.audioManager.playSound('kick', 0.8);
                this.audioManager.playSound('dash', { volume: 0.4, rate: 1.2 });
            }

            // Reset Kick animation
            if (this.animations.kick) {
                this.animations.kick.reset();
            }
        }
    }

    updateProjectiles(dt, level) {
        for (let i = this.golfProjectiles.length - 1; i >= 0; i--) {
            const proj = this.golfProjectiles[i];
            
            // Update position
            proj.x += proj.velocityX * dt;
            proj.y += proj.velocityY * dt;
            
            // Apply per-shot gravity for straight hooks and arcing bombs.
            proj.velocityY += Config.GRAVITY * (proj.gravityScale ?? 0.15) * dt;
            
            // Update lifetime
            proj.age += dt;
            
            // Remove if lifetime expired
            if (proj.age >= proj.lifetime) {
                this.golfProjectiles.splice(i, 1);
                continue;
            }
            
            // Remove if out of bounds
            if (level) {
                if (proj.x < -100 || proj.x > level.width + 100 || proj.y > level.height + 100) {
                    this.golfProjectiles.splice(i, 1);
                    continue;
                }
            }
            
            // Check platform collision (projectiles hit walls/platforms)
            if (level && level.checkPlatformCollision) {
                const projRect = {
                    x: proj.x - proj.width / 2,
                    y: proj.y - proj.height / 2,
                    width: proj.width,
                    height: proj.height
                };
                const prevRect = {
                    x: projRect.x - proj.velocityX * dt,
                    y: projRect.y - proj.velocityY * dt,
                    width: proj.width,
                    height: proj.height
                };
                const collision = level.checkPlatformCollision(projRect, prevRect, proj.velocityY);
                const hitWall = typeof level.getWallAt === 'function' ? level.getWallAt(projRect) : null;

                // If projectile hits solid geometry, create spray and remove projectile
                if (hitWall || (collision && collision.platform && collision.platform.type === 'static')) {
                    this.createGolfImpact(proj.x, proj.y, proj.shotType);
                    this.golfProjectiles.splice(i, 1);
                    continue;
                }
            }
        }
        
        // Update spray clouds
        for (let i = this.golfSprays.length - 1; i >= 0; i--) {
            const spray = this.golfSprays[i];
            spray.age += dt;
            
            // Expand spray radius over time
            spray.radius = spray.startRadius + (spray.maxRadius - spray.startRadius) * (spray.age / spray.duration);
            
            // Update particles
            for (let j = spray.particles.length - 1; j >= 0; j--) {
                const p = spray.particles[j];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vx *= 0.95; // Friction
                p.vy *= 0.95;
                p.age += dt;
                if (p.age >= p.lifetime) {
                    spray.particles.splice(j, 1);
                }
            }
            
            // Remove spray cloud when expired
            if (spray.age >= spray.duration) {
                this.golfSprays.splice(i, 1);
            }
        }
    }
    
    createGolfImpact(x, y, shotType = 'gold') {
        const impactConfig = {
            gold: { radius: 100, duration: 0.8, colors: ['#FFD54A', '#FFF4B0'] },
            fireball: { radius: 90, duration: 0.65, colors: ['#FF3B18', '#FFB11B'] },
            hookshot: { radius: 45, duration: 0.45, colors: ['#B8C4CE', '#F4F7FA'] },
            fishing: { radius: 55, duration: 0.65, colors: ['#18B7D8', '#B8F4FF'] },
            bomb: { radius: 145, duration: 0.75, colors: ['#FF7A18', '#3A3131'] }
        }[shotType] || { radius: 100, duration: 0.8, colors: ['#FFFFFF', '#E0E0E0'] };
        const spray = {
            x: x,
            y: y,
            age: 0,
            shotType,
            duration: impactConfig.duration,
            startRadius: 30,
            maxRadius: impactConfig.radius,
            radius: 30,
            hitEnemies: new Set(), // Track which enemies have been hit
            particles: []
        };
        
        // Create spray particles
        const particleCount = 25;
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
            const speed = 60 + Math.random() * 120;
            spray.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                age: 0,
                lifetime: 0.6 + Math.random() * 0.4,
                size: 3 + Math.random() * 5,
                color: impactConfig.colors[Math.random() > 0.5 ? 0 : 1]
            });
        }
        
        this.golfSprays.push(spray);
        
        // Play spray impact sound
        if (this.audioManager) {
            this.audioManager.playSound('golf_shot', { volume: 0.5, rate: 0.8 });
        }
    }

    takeDamage(damage, source = null) {
        // Debug logging for instant death investigation
        if (typeof Config !== 'undefined' && Config.DEBUG) {
            console.log('Player.takeDamage called', { 
                damage, 
                health: this.health, 
                invulnerable: this.invulnerableTimer > 0,
                isKicking: this.isKicking,
                source: source ? source.enemyType || 'unknown' : 'none'
            });
        }

        // If the player is already dead, signal death immediately so the
        // death handler can pick it up (prevents zombie-player state).
        if (this.health <= 0) {
            return true;
        }
        
        // Kick grants brief i-frames without the normal invuln flashing
        if (this.isKicking) {
            return false;
        }
        
        // Check invulnerability timer
        if (this.invulnerableTimer <= 0) {
            this.health -= damage;
            
            // Safety check - never let health go below 1 on first hit
            // (prevents instant death from massive damage)
            if (this.health <= 0 && this.maxHealth > 0) {
                const wasFullHealth = (this.health + damage) >= this.maxHealth;
                if (wasFullHealth && damage >= this.maxHealth) {
                    // Took massive damage from full health - cap it
                    console.warn('Prevented instant death from massive damage:', damage);
                    this.health = 1;
                    return false;
                }
            }

            // Clamp health to 0 minimum (prevents confusing negative values)
            if (this.health < 0) this.health = 0;
            
            // Only grant i-frames if the player survived the hit.
            // A lethal blow should NOT set invulnerability — it would
            // block the death handler from recognising the kill.
            const isDead = this.health <= 0;
            if (!isDead) {
                this.invulnerableTimer = this.invulnerableDuration;
            }
            this.hitStunTimer = 0.2;

            // Track damage taken for achievements
            this._lastDamageTaken = damage;

            // Knockback
            if (source) {
                const knockbackDirection = this.x < source.x ? -1 : 1;
                this.velocityX = knockbackDirection * 300;
                this.velocityY = -200;
            }

            if (this.audioManager) {
                this.audioManager.playSound('player_hit', 0.8);
            }

            // Reset hurt animation
            if (this.animations.hurt) {
                this.animations.hurt.reset();
            }

            return isDead;
        }
        return false;
    }

    reset() {
        this.x = 100;
        this.y = 500;
        this.health = this.maxHealth;
        this.velocityX = 0;
        this.velocityY = 0;
        this.targetVelocityX = 0;
        this.jumpsRemaining = this.maxJumps;
        this.comboCount = 0;
        this._lastComboTier = 0;
        this._multiHitCount = 0;
        this.hitStunTimer = 0;
        this.invulnerableTimer = 0;

        this.isDying = false;
        this.deathTimer = 0;
        this._stopClimbing();

        // Reset power-up effects on respawn
        this.speedBoost = null;
        this.damageBoost = null;
        this.healthRegen = null;
        // Note: idolBonuses persist across respawns within the same level
        // They only reset when starting a new level

        // Reset attack state and clear any stuck input (e.g., missed keyup
        // during transitions) so the player doesn't auto-run on respawn.
        this.isAttacking = false;
        this.isKicking = false;
        this.isGolfShooting = false;
        this.golfShotTimer = 0;
        this.attackTimer = 0;
        this.attackCooldownTimer = 0;
        // Golf Shot ammo: clear leftover ammo from the previous run and
        // grant one starting charge so every fresh game begins with one
        // available Golf Shot. (reset() is only called on new-game start,
        // not on mid-run respawn, so collected ammo is not wiped between
        // life losses.)
        this.golfAmmo = 1;
        this.golfCooldownTimer = 0;
        try { this.hitEnemies && this.hitEnemies.clear && this.hitEnemies.clear(); } catch (e) { __err('player', e); }
        this._prevAttackHitbox = null;
        this.jumpBufferTimer = 0;
        this.jumpBufferCount = 0;
        this.clearInputState();
    }

    clearInputState() {
        // Clear held keys; used when focus is lost or levels transition.
        this.keys = {};
        this.targetVelocityX = 0;
    }

    update(dt, level) {
        // Snapshot prior attack hitbox for swept collision checks (important for dash attacks)
        if (this.isAttacking) {
            this._prevAttackHitbox = {
                x: this.attackHitbox.x,
                y: this.attackHitbox.y,
                width: this.attackHitbox.width,
                height: this.attackHitbox.height
            };
        } else {
            this._prevAttackHitbox = null;
        }

        // Update timers
        if (this.coyoteTimer > 0) this.coyoteTimer -= dt;
        if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= dt;
            if (this.jumpBufferTimer <= 0) {
                this.jumpBufferTimer = 0;
                this.jumpBufferCount = 0;
            }
        }
        if (this.comboTimer > 0) {
            this.comboTimer -= dt;
        } else if (this.comboCount > 0) {
            if (this.comboCount >= 3 && this.audioManager) {
                // Dropped a meaningful combo — play the break sound
                this.audioManager.playSound('combo_break', { volume: 0.5, rate: 0.95 });
            }
            this.comboCount = 0;
            this.comboTimer = 0;
            this._lastComboTier = 0;
        }

        // Update health regeneration effect (only if alive)
        if (this.healthRegen && this.health > 0) {
            this.healthRegen.timer += dt;
            const healAmount = this.healthRegen.hpPerSecond * dt;
            this.health = Math.min(this.maxHealth, this.health + healAmount);
            
            // Update healing visual effect
            if (this.healthRegenEffect) {
                this.healthRegenEffect.emitFromPlayer(this, dt);
            }
            
            // Remove effect when duration expires
            if (this.healthRegen.timer >= this.healthRegen.duration) {
                this.healthRegen = null;
                if (this.healthRegenEffect) {
                    this.healthRegenEffect.clear();
                }
            }
        }
        
        // Always update health regen effect particles (for fade out)
        if (this.healthRegenEffect) {
            this.healthRegenEffect.update(dt);
        }

        // Update speed boost effect
        if (this.speedBoost) {
            this.speedBoost.timer += dt;
            
            // Update speed trail visual effect
            if (this.speedTrailEffect) {
                this.speedTrailEffect.emitFromPlayer(this, dt);
            }
            
            // Remove effect when duration expires
            if (this.speedBoost.timer >= this.speedBoost.duration) {
                this.speedBoost = null;
                if (this.speedTrailEffect) {
                    this.speedTrailEffect.clear();
                }
            }
        }
        
        // Always update speed trail effect particles (for fade out)
        if (this.speedTrailEffect) {
            this.speedTrailEffect.update(dt);
        }
        
        // Update damage boost effect
        if (this.damageBoost) {
            this.damageBoost.timer += dt;
            
            // Update damage boost visual effect
            if (this.damageBoostEffect) {
                this.damageBoostEffect.emitFromPlayer(this, dt);
            }
            
            // Remove effect when duration expires
            if (this.damageBoost.timer >= this.damageBoost.duration) {
                this.damageBoost = null;
                if (this.damageBoostEffect) {
                    this.damageBoostEffect.clear();
                }
            }
        }
        
        // Always update damage boost effect particles (for fade out)
        if (this.damageBoostEffect) {
            this.damageBoostEffect.update(dt);
        }

        // Update skunk projectiles
        this.updateProjectiles(dt, level);

        if (this.hitStunTimer > 0) this.hitStunTimer -= dt;
        if (this.invulnerableTimer > 0) this.invulnerableTimer -= dt;

        // Update footstep timer
        if (this.footstepTimer > 0) this.footstepTimer -= dt;

        // Determine target velocity based on input
        this.targetVelocityX = 0;
        if (this.hitStunTimer <= 0) {
            if (this.keys['arrowleft'] || this.keys['a'] || this.keys['keya']) {
                this.targetVelocityX = -this.speed;
                if (!this.isAttacking) this.facingRight = false;
            }
            if (this.keys['arrowright'] || this.keys['d'] || this.keys['keyd']) {
                this.targetVelocityX = this.speed;
                if (!this.isAttacking) this.facingRight = true;
            }
        }

        // Apply speed boost multiplier if active
        if (this.speedBoost && this.speedBoost.multiplier) {
            this.targetVelocityX *= this.speedBoost.multiplier;
        }
        
        // Apply idol bonuses (stacking speed increase)
        if (this.idolBonuses && this.idolBonuses.speed > 0) {
            this.targetVelocityX *= (1 + this.idolBonuses.speed);
        }

        // Smooth acceleration/deceleration
        if (this.targetVelocityX !== 0) {
            if (Math.abs(this.velocityX) < Math.abs(this.targetVelocityX)) {
                this.velocityX += (this.targetVelocityX / Math.abs(this.targetVelocityX)) * this.acceleration * dt;
                if (Math.abs(this.velocityX) > Math.abs(this.targetVelocityX)) {
                    this.velocityX = this.targetVelocityX;
                }
            } else {
                this.velocityX = this.targetVelocityX;
            }
        } else {
            if (Math.abs(this.velocityX) > 0 && !this.isKicking) {
                const frictionAmount = this.friction * dt;
                if (Math.abs(this.velocityX) <= frictionAmount) {
                    this.velocityX = 0;
                } else {
                    this.velocityX -= (this.velocityX / Math.abs(this.velocityX)) * frictionAmount;
                }
            }
            if (Math.abs(this.velocityX) < 0.1) {
                this.velocityX = 0;
            }
        }

        const wasOnGround = this.onGround;
        const prevRect = { x: this.x, y: this.y, width: this.width, height: this.height };
        const upPressed = !!(this.keys['arrowup'] || this.keys['w'] || this.keys['keyw']);
        const downPressed = !!(this.keys['arrowdown'] || this.keys['s'] || this.keys['keys']);
        const climbable = level && typeof level.getClimbableAt === 'function' ? level.getClimbableAt(prevRect) : null;
        const wantsClimb = !!climbable && (upPressed || downPressed);

        if (!this.isClimbing && wantsClimb && this.hitStunTimer <= 0 && !this.isDying) {
            this._startClimbing(climbable);
        }

        if (this.isClimbing) {
            const activeClimbable = climbable || this._climbable;
            if (!activeClimbable || this.hitStunTimer > 0 || this.isDying) {
                this._stopClimbing();
            } else if (Math.abs(this.targetVelocityX) > 0 && !wantsClimb) {
                this._stopClimbing();
            } else {
                const climbDirection = (upPressed ? -1 : 0) + (downPressed ? 1 : 0);
                if (climbDirection !== 0) {
                    this.y += climbDirection * this.climbSpeed * dt;
                }
                this.y = Utils.clamp(
                    this.y,
                    activeClimbable.y - this.height,
                    activeClimbable.y + activeClimbable.height - this.height
                );
                this.x = activeClimbable.x + (activeClimbable.width - this.width) / 2;
                this.velocityX = 0;
                this.velocityY = 0;
                this.targetVelocityX = 0;
                this.onGround = false;
                this.coyoteTimer = 0;
                this.jumpsRemaining = this.maxJumps;
            }
        }

        // Apply gravity
        if (!this.isClimbing) {
            this.velocityY += Config.GRAVITY * dt;
            if (this.velocityY > Config.MAX_FALL_SPEED) {
                this.velocityY = Config.MAX_FALL_SPEED;
            }
        } else {
            this.velocityY = 0;
        }


        // Update horizontal position
        if (!this.isClimbing && Math.abs(this.velocityX) > 0) {
            this.x += this.velocityX * dt;
        }

        // Update vertical position
        if (!this.isClimbing) {
            this.y += this.velocityY * dt;
        }

        // Preserve pre-resolution vertical velocity so hard landings still
        // trigger feedback even if a solid wall resolves first.
        const preCollisionVY = this.velocityY;

        let groundedBySolid = false;
        if (!this.isClimbing && level && typeof level.resolveSolidCollision === 'function') {
            const solidResult = level.resolveSolidCollision(
                { x: this.x, y: this.y, width: this.width, height: this.height },
                prevRect
            );
            this.x = solidResult.x;
            this.y = solidResult.y;
            if (solidResult.collidedX) this.velocityX = 0;
            if (solidResult.collidedY) this.velocityY = 0;
            groundedBySolid = !!solidResult.landed;
        }

        // Check platform collisions (pass prevRect)
        const rect = { x: this.x, y: this.y, width: this.width, height: this.height };
        const collision = level.checkPlatformCollision(rect, prevRect, this.velocityY);

        if (collision.collided) {
            this.y = collision.landingY;
            this.velocityY = 0;
            this.onGround = true;
            if (this.isClimbing) this._stopClimbing();
            this.jumpsRemaining = this.maxJumps;
            
            // Play landing sound if falling from significant height.
            // Note: velocity is positive when falling (downwards).
            if (!wasOnGround && preCollisionVY > 450) {
                if (this.audioManager) {
                    const rate = 0.96 + Math.random() * 0.06; // 0.96..1.02 (subtle)
                    this.audioManager.playSound('land', { volume: 0.6, rate });
                }
            }
        } else {
            this.onGround = groundedBySolid;
            if (groundedBySolid) {
                this.jumpsRemaining = this.maxJumps;
                if (!wasOnGround && preCollisionVY > 450 && this.audioManager) {
                    const rate = 0.96 + Math.random() * 0.06;
                    this.audioManager.playSound('land', { volume: 0.6, rate });
                }
            }
        }

        // Update coyote timer
        if (wasOnGround && !this.onGround) {
            this.coyoteTimer = this.coyoteTime;
        } else if (this.onGround) {
            this.coyoteTimer = 0;
        }

        // Play footstep sounds when walking on ground
        if (this.onGround && Math.abs(this.velocityX) > 50 && this.footstepTimer <= 0 && !this.isAttacking && !this.isKicking) {
            if (this.audioManager) {
                // Subtle variation prevents “machine-gun” repetition.
                const rate = 0.96 + Math.random() * 0.08; // 0.96..1.04
                this.audioManager.playSound('footstep', { volume: 0.3, rate });
            }
            this.footstepTimer = this.footstepInterval;
        }

        // Handle jump buffering
        if (this.jumpBufferCount > 0 && (this.onGround || this.coyoteTimer > 0 || this.jumpsRemaining > 0)) {
            this.jump();
            this.jumpBufferCount = Math.max(0, this.jumpBufferCount - 1);
            if (this.jumpBufferCount === 0) this.jumpBufferTimer = 0;
        }

        // Update attack
        if (this.isAttacking) {
            this.attackTimer -= dt;
            if (this.attackTimer <= 0) {
                this.isAttacking = false;
                this.isKicking = false;
                this._attackDidHit = false;
                this.attackHitbox.width = this.defaultAttackWidth;
                this.attackHitbox.height = this.defaultAttackHeight;
                if (Math.abs(this.velocityX) > this.speed) {
                    this.velocityX = Utils.clamp(this.velocityX, -this.speed, this.speed);
                }
            }
        }

        if (this.attackCooldownTimer > 0) {
            this.attackCooldownTimer -= dt;
        }
        
        if (this.golfCooldownTimer > 0) {
            this.golfCooldownTimer -= dt;
        }

        if (this.golfShotTimer > 0) {
            this.golfShotTimer -= dt;
            if (this.golfShotTimer <= 0) {
                this.golfShotTimer = 0;
                this.isGolfShooting = false;
            }
        }

        // Update attack hitbox position
        if (this.isAttacking) {
            this._updateAttackHitboxPosition();
        }

        // Update animations
        this.updateAnimation(dt);

        // Bounds checking
        this.x = Utils.clamp(this.x, 0, level.width - this.width);
    }

    updateAnimation(dt) {
        let newState = "idle";

        if (this.isDying) {
            newState = "death";
        } else if (this.hitStunTimer > 0) {
            newState = "hurt";
        } else if (this.isClimbing) {
            newState = "climb";
        } else if (this.isGolfShooting && this.golfShotTimer > 0) {
            newState = "golf_shot";
        } else if (this.isKicking) {
            newState = "kick";
        } else if (this.isAttacking) {
            newState = "attack";
        } else if (!this.onGround) {
            newState = "jump";
        } else if (Math.abs(this.velocityX) > 10) {
            newState = "walk";
        }

        if (newState !== this.animationState) {
            this.animationState = newState;
            this.currentAnimation = this.animations[newState];
            if (this.currentAnimation) {
                this.currentAnimation.reset();
            }
        }

        if (this.currentAnimation) {
            this.currentAnimation.update(dt);
        }
    }

    startDeath(opts) {
        if (this.isDying) return;
        this.isDying = true;
        this.deathTimer = this.deathDuration;
        this.velocityX = 0;
        this.velocityY = 0;
        this.isAttacking = false;
        this.isKicking = false;
        this.hitStunTimer = 0;
        this.invulnerableTimer = 0;
        const isFinal = !!(opts && opts.final);
        try {
            if (this.audioManager && typeof this.audioManager.playDeathSequence === 'function') {
                if (isFinal) {
                    // Long, drawn-out final-death stinger: louder oof + longer
                    // delay before the game-over musical cue.
                    this.audioManager.playDeathSequence({
                        oof: 'player_death',
                        follow: 'game_over',
                        delayMs: 1400,
                        oofVolume: 1.0,
                        followVolume: 1.0,
                        finalTail: true
                    });
                } else {
                    // Non-final death: short oof only, no game-over stinger.
                    if (this.audioManager.playSound) {
                        this.audioManager.playSound('player_death', 0.9);
                    }
                }
            } else if (this.audioManager && this.audioManager.playSound) {
                // Fallback for older AudioManager
                this.audioManager.playSound('player_death', 0.9);
            }
        } catch (e) { __err('player', e); }
        if (this.animations && this.animations.death) {
            this.animations.death.reset();
        }
        this.updateAnimation(0);
    }

    updateDeath(dt) {
        if (!this.isDying) return;
        if (this.deathTimer > 0) {
            this.deathTimer -= dt;
            this.updateAnimation(dt);
        } else if (this.currentAnimation) {
            // Hold on the last frame once the animation completes
            this.currentAnimation.currentFrame = Math.max(0, this.currentAnimation.frameCount - 1);
        }
    }

    draw(ctx, cameraX = 0, cameraY = 0) {
        ctx.save();
        ctx.translate(-cameraX, -cameraY);
        
        // Draw speed trail effect (behind player)
        if (this.speedTrailEffect && this.speedBoost) {
            this.speedTrailEffect.draw(ctx);
        }
        
        // Draw health regen effect (behind player)
        if (this.healthRegenEffect && this.healthRegen) {
            this.healthRegenEffect.draw(ctx);
        }
        
        // Draw damage boost effect (behind player)
        if (this.damageBoostEffect && this.damageBoost) {
            this.damageBoostEffect.draw(ctx);
        }

        // Draw shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(this.x + this.width / 2, this.y + this.height, this.width / 2, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        // Flash when invulnerable
        if (!this.isDying && this.invulnerableTimer > 0 && Math.floor(this.invulnerableTimer * 20) % 2 === 0) {
            ctx.restore();
            return;
        }

        // Draw sprite or colored rectangle
        if (this.currentAnimation) {
            // Add speed boost glow effect
            if (this.speedBoost) {
                ctx.save();
                ctx.shadowColor = '#00D9FF';
                ctx.shadowBlur = 15 + Math.sin(Date.now() / 100) * 5; // Pulsing glow
                ctx.globalCompositeOperation = 'lighter';
                this.currentAnimation.draw(ctx, this.x, this.y, this.width, this.height, !this.facingRight);
                ctx.restore();
            }
            // Add health regen glow effect
            if (this.healthRegen) {
                ctx.save();
                ctx.shadowColor = '#00FF88';
                ctx.shadowBlur = 12 + Math.sin(Date.now() / 120) * 4; // Pulsing green glow
                ctx.globalCompositeOperation = 'lighter';
                this.currentAnimation.draw(ctx, this.x, this.y, this.width, this.height, !this.facingRight);
                ctx.restore();
            }
            // Add damage boost glow effect
            if (this.damageBoost) {
                ctx.save();
                ctx.shadowColor = '#FF4444';
                ctx.shadowBlur = 18 + Math.sin(Date.now() / 90) * 6; // Pulsing red glow
                ctx.globalCompositeOperation = 'lighter';
                this.currentAnimation.draw(ctx, this.x, this.y, this.width, this.height, !this.facingRight);
                ctx.restore();
            }
            // Add idol collection bonus glow effect (golden aura)
            if (this.idolBonuses && this.idolBonuses.count > 0) {
                ctx.save();
                // Golden glow that intensifies with more idols collected
                const intensity = 10 + (this.idolBonuses.count * 5);
                ctx.shadowColor = '#FFD700';
                ctx.shadowBlur = intensity + Math.sin(Date.now() / 150) * (intensity * 0.3); // Pulsing golden glow
                ctx.globalCompositeOperation = 'lighter';
                this.currentAnimation.draw(ctx, this.x, this.y, this.width, this.height, !this.facingRight);
                ctx.restore();
            }
            // Cosmetic skin aura. Gold = early-access Founder exclusive;
            // sapphire/amethyst/steel = unlocked by Remove Ads ($2.99). The
            // gating lives entirely inside FounderManager.isGoldSkinEnabled(),
            // which now returns true for any player with an unlocked variant
            // and the cosmetic toggle on.
            const _founderGold = (typeof FounderManager !== 'undefined' &&
                typeof FounderManager.isGoldSkinEnabled === 'function' &&
                FounderManager.isGoldSkinEnabled());
            const _founderVariant = (_founderGold && typeof FounderManager.getSkinVariant === 'function')
                ? FounderManager.getSkinVariant()
                : 'gold';
            const _founderAuraColor = (_founderGold && typeof GoldenSkin !== 'undefined' && typeof GoldenSkin.getAuraColor === 'function')
                ? GoldenSkin.getAuraColor(_founderVariant)
                : '#FFC857';
            if (_founderGold) {
                ctx.save();
                ctx.shadowColor = _founderAuraColor;
                ctx.shadowBlur = 8 + Math.sin(Date.now() / 220) * 3;
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.55;
                this.currentAnimation.draw(ctx, this.x, this.y, this.width, this.height, !this.facingRight);
                ctx.restore();
            }
            // Final base-sprite blit. Founders get the chosen colour-tinted
            // skin generated procedurally by GoldenSkin from the same source
            // sprite sheet — silhouette and animation frames are identical.
            if (_founderGold &&
                typeof GoldenSkin !== 'undefined' &&
                typeof GoldenSkin.drawAnimation === 'function') {
                GoldenSkin.drawAnimation(this.currentAnimation, ctx, this.x, this.y, this.width, this.height, !this.facingRight, _founderVariant);
            } else {
                this.currentAnimation.draw(ctx, this.x, this.y, this.width, this.height, !this.facingRight);
            }
        } else {
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.width, this.height);
        }

        // Attack range FX: render only during active damage frames.
        if (this.isAttacking && this.isAttackDamageActive() && !(typeof Config !== 'undefined' && Config.SHOW_HITBOXES)) {
            try {
                const hb = this.getAttackHitboxForCollision() || this.attackHitbox;
                if (typeof drawAttackWispTelegraph === 'function') {
                    drawAttackWispTelegraph(ctx, hb, {
                        facingRight: this.facingRight,
                        progress: (this.attackDuration > 0) ? (1 - (this.attackTimer / this.attackDuration)) : 0.5,
                        intensity: this.isKicking ? 1.15 : 1,
                        alpha: this.isKicking ? 0.5 : 0.42,
                        coreColor: this.isKicking ? 'rgba(255, 246, 210, 0.95)' : 'rgba(255, 240, 220, 0.95)',
                        tintA: this.isKicking ? 'rgba(255, 220, 110, 0.68)' : 'rgba(255, 170, 110, 0.58)',
                        tintB: this.isKicking ? 'rgba(255, 170, 60, 0.26)' : 'rgba(255, 110, 90, 0.24)',
                        tintC: 'rgba(255, 90, 60, 0)'
                    });
                }
            } catch (e) { __err('player', e); }
        }

        // Debug: draw collision boxes
        if (typeof Config !== 'undefined' && (Config.DEBUG || Config.SHOW_HITBOXES)) {
            // Player body
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.65)';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.width, this.height);

            // Attack hitbox (only while attacking)
            if (this.isAttacking) {
                ctx.strokeStyle = this.isKicking
                    ? 'rgba(255, 215, 0, 0.7)'
                    : 'rgba(255, 0, 0, 0.55)';
                ctx.lineWidth = 2;
                ctx.strokeRect(this.attackHitbox.x, this.attackHitbox.y, this.attackHitbox.width, this.attackHitbox.height);

                // Kick swept hitbox (helps visualize dash collisions)
                try {
                    const swept = (typeof this.getAttackHitboxForCollision === 'function') ? this.getAttackHitboxForCollision() : null;
                    if (swept && this.isKicking) {
                        ctx.strokeStyle = 'rgba(255, 200, 80, 0.5)';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(swept.x, swept.y, swept.width, swept.height);
                    }
                } catch (e) { __err('player', e); }
            }
        }

        ctx.restore();
    }
    
    /**
     * Draw skunk projectiles and spray clouds
     */
    drawProjectiles(ctx, cameraX, cameraY) {
        // Draw spray clouds first (behind projectiles)
        for (const spray of this.golfSprays) {
            ctx.save();
            
            const screenX = spray.x - cameraX;
            const screenY = spray.y - cameraY;
            
            // Draw expanding spray cloud area
            const alpha = 1 - (spray.age / spray.duration);
            const cloudColors = {
                gold: [`rgba(255, 213, 74, ${alpha * 0.35})`, 'rgba(255, 213, 74, 0)'],
                fireball: [`rgba(255, 70, 20, ${alpha * 0.42})`, 'rgba(255, 40, 0, 0)'],
                hookshot: [`rgba(190, 205, 215, ${alpha * 0.3})`, 'rgba(190, 205, 215, 0)'],
                fishing: [`rgba(30, 190, 220, ${alpha * 0.32})`, 'rgba(30, 190, 220, 0)'],
                bomb: [`rgba(255, 130, 20, ${alpha * 0.48})`, 'rgba(40, 30, 30, 0)']
            }[spray.shotType] || [`rgba(255, 255, 255, ${alpha * 0.3})`, 'rgba(230, 230, 230, 0)'];
            const cloudGrad = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, spray.radius);
            cloudGrad.addColorStop(0, cloudColors[0]);
            cloudGrad.addColorStop(1, cloudColors[1]);
            ctx.fillStyle = cloudGrad;
            ctx.beginPath();
            ctx.arc(screenX, screenY, spray.radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw spray particles
            ctx.globalCompositeOperation = 'lighter';
            for (const p of spray.particles) {
                const pAlpha = 1 - (p.age / p.lifetime);
                ctx.globalAlpha = pAlpha * 0.8;
                
                const pGrad = ctx.createRadialGradient(
                    p.x - cameraX, p.y - cameraY, 0,
                    p.x - cameraX, p.y - cameraY, p.size
                );
                pGrad.addColorStop(0, '#FFFFFF');
                pGrad.addColorStop(0.4, p.color);
                pGrad.addColorStop(1, 'rgba(230, 230, 230, 0)');
                
                ctx.fillStyle = pGrad;
                ctx.beginPath();
                ctx.arc(p.x - cameraX, p.y - cameraY, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            
            ctx.restore();
        }
        
        // Draw projectiles
        for (const proj of this.golfProjectiles) {
            const screenX = proj.x - cameraX;
            const screenY = proj.y - cameraY;
            
            ctx.save();
            ctx.translate(screenX, screenY);
            const shotColors = {
                gold: ['#FFF8C6', '#E4A900'],
                fireball: ['#FFF2A0', '#F02B12'],
                hookshot: ['#F4F7FA', '#788691'],
                fishing: ['#D8FAFF', '#0796B5'],
                bomb: ['#656565', '#171717']
            }[proj.shotType] || ['#FFFFFF', '#D8D8D8'];
            
            // Draw motion trail
            const trailLength = 3;
            const velocityMag = Math.sqrt(proj.velocityX * proj.velocityX + proj.velocityY * proj.velocityY);
            const normalizedVelX = proj.velocityX / velocityMag;
            const normalizedVelY = proj.velocityY / velocityMag;
            
            for (let j = 1; j <= trailLength; j++) {
                const trailAlpha = (trailLength - j) / trailLength * 0.3;
                const trailX = -normalizedVelX * j * 8;
                const trailY = -normalizedVelY * j * 8;
                const trailSize = proj.width * (1 - j / trailLength * 0.5);
                
                ctx.globalAlpha = trailAlpha;
                ctx.fillStyle = shotColors[0];
                ctx.beginPath();
                ctx.arc(trailX, trailY, trailSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Draw soft white glow
            const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, proj.width * 1.2);
            glowGrad.addColorStop(0, shotColors[0]);
            glowGrad.addColorStop(0.55, shotColors[1]);
            glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(0, 0, proj.width * 1.2, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw a white golf ball projectile with a couple of dimples
            const ballR = proj.width / 2;
            const ballShade = ctx.createRadialGradient(-ballR * 0.35, -ballR * 0.35, ballR * 0.1, 0, 0, ballR);
            ballShade.addColorStop(0, shotColors[0]);
            ballShade.addColorStop(1, shotColors[1]);
            ctx.fillStyle = ballShade;
            ctx.strokeStyle = 'rgba(160, 160, 160, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, ballR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = 'rgba(180, 180, 180, 0.55)';
            const dimples = [[0, -ballR * 0.4], [ballR * 0.4, ballR * 0.15], [-ballR * 0.4, ballR * 0.15]];
            for (const [dx, dy] of dimples) {
                ctx.beginPath();
                ctx.arc(dx, dy, ballR * 0.14, 0, Math.PI * 2);
                ctx.fill();
            }
            
            ctx.restore();
        }
    }

    getRect() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
    }

    _updateAttackHitboxPosition() {
        // Allow a small overlap with the player body so point-blank hits register.
        const overlap = Math.min(8, Math.floor(this.attackHitbox.width * 0.22));
        const offsetX = this.facingRight
            ? (this.width - overlap)
            : (-this.attackHitbox.width + overlap);
        this.attackHitbox.x = this.x + offsetX;
        this.attackHitbox.y = this.y + (this.height - this.attackHitbox.height) / 2;
    }

    isAttackDamageActive() {
        if (!this.isAttacking) return false;
        if (!this.isKicking) return true;

        const anim = this.animations && this.animations.kick;
        if (anim && typeof anim.currentFrame === 'number' && typeof anim.frameCount === 'number') {
            // Active on all frames except first/last
            return anim.currentFrame > 0 && anim.currentFrame < (anim.frameCount - 1);
        }

        // Fallback: active for the middle 70% of the move
        const dur = this.kickDuration || 0.4;
        const elapsed = dur - (this.attackTimer || 0);
        const t = Utils.clamp(elapsed / dur, 0, 1);
        return t >= 0.15 && t <= 0.85;
    }
    
    /**
     * Get current attack damage with damage boost multiplier applied
     */
    getCurrentDamage() {
        let damage = this.attackDamage;
        // Apply damage boost power-up
        if (this.damageBoost && this.damageBoost.multiplier) {
            damage *= this.damageBoost.multiplier;
        }
        // Apply idol bonuses (stacking damage increase)
        if (this.idolBonuses && this.idolBonuses.damage > 0) {
            damage *= (1 + this.idolBonuses.damage);
        }
        return Math.floor(damage);
    }

    /**
     * Get the current score multiplier based on combo count.
     * Scales linearly from base, capped at max.
     */
    getComboMultiplier() {
        const cfg = Config.COMBO || {};
        const base = cfg.SCORE_MULTIPLIER_BASE || 1.0;
        const perStack = cfg.SCORE_MULTIPLIER_PER_STACK || 0.25;
        const max = cfg.SCORE_MULTIPLIER_MAX || 10.0;
        if (this.comboCount <= 1) return base;
        return Math.min(base + (this.comboCount - 1) * perStack, max);
    }

    /**
     * Called when the player hits multiple enemies in one attack.
     * Grants bonus combo stacks and extends the combo window.
     */
    registerMultiHit(enemiesHit) {
        if (enemiesHit <= 1) return;
        const cfg = Config.COMBO || {};
        const extraStacks = (cfg.MULTI_HIT_COMBO_BOOST || 1) * (enemiesHit - 1);
        this.comboCount = Math.min(this.comboCount + extraStacks, this.maxCombo);
        // Extend combo window for multi-kills
        const windowBonus = (cfg.COMBO_WINDOW_BONUS || 0.3) * (enemiesHit - 1);
        this.comboTimer = Math.min(this.comboTimer + windowBonus, this.comboWindow + windowBonus);
        this._multiHitCount = enemiesHit;
    }

    /**
     * Increment combo when landing a hit on an enemy.
     * Called from game.js when attackResult.hit is true.
     * Adds 1 combo stack per successful attack (multi-hit bonus is handled separately).
     */
    incrementCombo() {
        if (this.comboTimer > 0) {
            // Continue combo
            this.comboCount = Math.min(this.comboCount + 1, this.maxCombo);
        } else {
            // Start new combo
            this.comboCount = 1;
        }
        this.comboTimer = this.comboWindow;

        // Play combo level up sound for combo >= 2
        if (this.audioManager && this.comboCount >= 2) {
            this.audioManager.playSound('combo_level_up', 0.55);
        }
    }

    /**
     * Get current combo tier info (label, color, etc.) or null if below any tier
     */
    getComboTier() {
        const tiers = (Config.COMBO && Config.COMBO.TIERS) || [];
        let best = null;
        for (const tier of tiers) {
            if (this.comboCount >= tier.threshold) {
                best = tier;
            }
        }
        return best;
    }

    getAttackHitboxForCollision() {
        if (!this.isAttacking) return null;
        if (!this.isKicking || !this._prevAttackHitbox) return this.attackHitbox;

        // Swept AABB: union of previous and current hitbox
        const x1 = Math.min(this._prevAttackHitbox.x, this.attackHitbox.x);
        const y1 = Math.min(this._prevAttackHitbox.y, this.attackHitbox.y);
        const x2 = Math.max(this._prevAttackHitbox.x + this._prevAttackHitbox.width, this.attackHitbox.x + this.attackHitbox.width);
        const y2 = Math.max(this._prevAttackHitbox.y + this._prevAttackHitbox.height, this.attackHitbox.y + this.attackHitbox.height);
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
}
