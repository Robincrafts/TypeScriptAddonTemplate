// Towers: the host's health and armor settings, growth of both over the game (so buffed late-game heroes do not melt
// them), and attack damage that grows from the host's start minute to the full minute, per kind of target. The creep
// multiplier goes into the base damage (visible in the stat panel); heroes and illusions get the rest per hit.
import { config } from "./config";

// Tower entity index -> its health, armor and attack damage after the host settings, before growth
const baseStats: Record<number, { health: number; armor: number; damageMin: number; damageMax: number }> = {};
// How far tower damage had grown at the last minute tick (0 to 1): base damage and the damage filter both use it
let appliedDamageProgress = 0;
let lastGrowthMinute = -1;

/** Call once at the pre-game: applies the host's multiplier and bonus and remembers each tower's starting numbers. */
export function applyTowerSettings() {
    for (const entity of Entities.FindAllByClassname("npc_dota_tower")) {
        const tower = entity as CDOTA_BaseNPC;
        const health = math.floor(tower.GetMaxHealth() * config.towerHealthMultiplier);
        const armor = tower.GetPhysicalArmorBaseValue() + config.towerArmorBonus;
        baseStats[tower.GetEntityIndex()] = { health, armor, damageMin: tower.GetBaseDamageMin(), damageMax: tower.GetBaseDamageMax() };
        setTowerStats(tower, health, armor);
    }
}

function setTowerStats(tower: CDOTA_BaseNPC, health: number, armor: number) {
    // Keep the share of health the tower has left, so growth never heals a damaged tower to full
    const share = tower.GetMaxHealth() > 0 ? tower.GetHealth() / tower.GetMaxHealth() : 1;
    tower.SetBaseMaxHealth(health);
    tower.SetMaxHealth(health);
    tower.SetHealth(math.max(math.floor(health * share), 1));
    tower.SetPhysicalArmorBaseValue(armor);
}

/** Called every second by the game tick; towers only change when a new game minute starts. */
export function updateTowerGrowth() {
    const minute = math.max(math.floor(GameRules.GetDOTATime(false, false) / 60), 0);
    if (minute === lastGrowthMinute) return;
    lastGrowthMinute = minute;

    const healthFactor = math.min(1 + (config.towerHealthPerMinute / 100) * minute, math.max(config.towerHealthMaxGrowth, 1));
    const armorBonus = math.min(config.towerArmorPer5Minutes * math.floor(minute / 5), config.towerArmorMaxGrowth);
    // Base damage grows with the creep multiplier, so the tower's stat panel shows it; heroes and illusions get the rest
    // through the damage filter
    appliedDamageProgress = damageProgress();
    const damageFactor = 1 + (config.towerDamageVsCreeps - 1) * appliedDamageProgress;

    for (const [index, base] of Object.entries(baseStats)) {
        const tower = EntIndexToHScript(tonumber(index) as EntityIndex) as CDOTA_BaseNPC | undefined;
        if (tower === undefined || !tower.IsAlive()) {
            delete baseStats[tonumber(index)!];
            continue;
        }
        setTowerStats(tower, math.floor(base.health * healthFactor), base.armor + armorBonus);
        tower.SetBaseDamageMin(math.floor(base.damageMin * damageFactor));
        tower.SetBaseDamageMax(math.floor(base.damageMax * damageFactor));
    }
}

/**
 * How far tower damage has grown: 0 until the start minute, 1 from the full minute on. With the full minute at (or
 * before) the start minute, towers hit at full strength from the start minute (by default from the very start).
 */
function damageProgress(): number {
    const minutes = math.max(GameRules.GetDOTATime(false, false) / 60, 0);
    if (minutes < config.towerDamageStartMinute) return 0;
    const span = config.towerDamageFullMinute - config.towerDamageStartMinute;
    if (span <= 0) return 1;
    return math.min((minutes - config.towerDamageStartMinute) / span, 1);
}

/**
 * Extra multiplier for a tower hit on this victim, on top of the grown base damage: creeps get nothing more,
 * heroes and illusions get the difference to their own multiplier.
 */
function towerDamageMultiplier(victim: CDOTA_BaseNPC): number {
    let full = config.towerDamageVsCreeps;
    if (victim.IsIllusion()) full = config.towerDamageVsIllusions;
    else if (victim.IsRealHero()) full = config.towerDamageVsHeroes;
    const wanted = 1 + (full - 1) * appliedDamageProgress;
    const inBase = 1 + (config.towerDamageVsCreeps - 1) * appliedDamageProgress;
    return wanted / inBase;
}

/** Registers the damage filter that makes tower attacks stronger. */
export function registerTowerDamage(mode: CDOTABaseGameMode) {
    mode.SetDamageFilter(event => {
        // Only plain attacks: spells and items have an inflictor
        if (event.entindex_inflictor_const !== undefined) return true;
        const attacker = EntIndexToHScript(event.entindex_attacker_const) as CDOTA_BaseNPC | undefined;
        if (attacker === undefined || !attacker.IsBaseNPC() || !attacker.IsTower()) return true;
        const victim = EntIndexToHScript(event.entindex_victim_const) as CDOTA_BaseNPC | undefined;
        if (victim === undefined || !victim.IsBaseNPC()) return true;

        event.damage *= towerDamageMultiplier(victim);
        return true;
    }, {});
}
