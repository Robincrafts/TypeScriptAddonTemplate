// How far each kind of stat may be buffed and how big one click is: one profile per stat type (damage kinds, area,
// range, disables, durations, chances, ...). Replaces the host's old global max/min multiplier.
//
// Every profile has a late-game ceiling: a multiple of the level-1 number and/or an absolute number (1200 radius, 60%
// chance). Only part of the room up to it is open early: CAP_EARLY_SHARE at minute 0, all of it at CAP_FULL_MINUTE, so
// a lucky early legendary click cannot max a stat. Stats where lower is better (cooldown, mana cost, delays) work the
// same way down to their floor.
import { disableSkills, disableWords, isCountValue, summonWords, unitWords } from "./skill_rules";
import { statGroup } from "./stat_types";

/** Share of a stat's room that is open at minute 0; grows in a straight line to all of it at CAP_FULL_MINUTE. */
const CAP_EARLY_SHARE = 0.2;
const CAP_FULL_MINUTE = 30;

/** A percentage that already starts above 100% (a reflect of 130%) may grow to at most this multiple of itself. */
const PERCENT_ABOVE_100_MULTIPLE = 5;

/** A % value from this size at level 1 (Elder Titan 34%, Nyx 9%) gets the big clicks (and, for pool damage, cap). */
const BIG_POOL_PERCENT = 5;

/**
 * Fixed clicks for a value Dota shows as a percentage, common to legendary, in % points (user's numbers): a small one
 * (under BIG_POOL_PERCENT at level 1, Heartstopper 0.8%) moves 0.1 / 0.2 / 0.3 / 0.5, a bigger one 1 / 2 / 3 / 5, and
 * one that starts above 100% moves 3 / 5 / 8 / 10.
 */
function percentClicks(size: number): number[] {
    // Above 100% (a 130% reflect with room up to 5x): fixed bigger clicks (user's numbers)
    if (size > 100) return [3, 5, 8, 10];
    return size >= BIG_POOL_PERCENT ? [1, 2, 3, 5] : [0.1, 0.2, 0.3, 0.5];
}

/** The smallest click (a profile's `minimum`) is never more than this share of the stat's level-1 number. */
const MAX_MINIMUM_SHARE = 0.25;

/** How far a stat may be pushed the bad way (a damage lowered by Alt+click), as a multiple of its normal number. */
const BAD_WAY_LOWEST = 0.25;
/** How far a lower-is-better stat (cooldown, delay) may be pushed the bad way: up to this multiple. */
const BAD_WAY_HIGHEST = 2;

type StatProfile = StatLimits;

/** How much of each stat's room is open right now (0.2 at minute 0 up to 1 at minute 30). */
export function capUnlock(): number {
    const minutes = math.max(GameRules.GetDOTATime(false, false) / 60, 0);
    return CAP_EARLY_SHARE + (1 - CAP_EARLY_SHARE) * math.min(minutes / CAP_FULL_MINUTE, 1);
}

const has = (lower: string, words: string[]) => words.some(word => lower.includes(word));
/** Whether one of `words` is a whole word of `text` (words split at spaces and underscores). */
function hasWord(text: string, words: string[]): boolean {
    for (const word of text.split("_").join(" ").split(" ")) if (words.includes(word)) return true;
    return text.includes("life_steal") || text.includes("life steal");
}
// "perc" only as a whole part of the name: Monkey King's "perched_spot_height" is not a percentage
const isPercentName = (lower: string) => has(lower, ["pct", "percent"]) || lower.split("_").includes("perc") || lower.endsWith("_pc");

/**
 * The tooltip facts of a value, from its generated label in tooltip_data.ts ("%Health decay"): the label in lowercase
 * without the "%", and whether the value is a percentage (the "%", or a name like damage_pct). `percentShown` is only
 * the "%": Ursa's "attack_speed_bonus_pct" 400 is shown as plain attack speed, not as a percentage above 100.
 */
export function tooltipFacts(label: string | undefined, statKey: string): { tooltip: string; percent: boolean; percentShown: boolean } {
    const byName = isPercentName(statKey.toLowerCase());
    // No label: the name alone is not proof of a percentage above 100 (Gyrocopter's 400 "attack_speed_bonus_pct")
    if (label === undefined) return { tooltip: "", percent: byName, percentShown: false };
    const percent = label.startsWith("%");
    return { tooltip: (percent ? label.substring(1) : label).toLowerCase(), percent: percent || byName, percentShown: percent };
}

// Damage that is a share of a health or mana pool (Heartstopper's "health decay" %, Reaper's Scythe's damage per
// missing health, Mana Void's damage per missing mana). Matched in the value name AND Dota's tooltip label.
const poolDamageWords = ["damage", "dmg", "decay", "burn", "loss", "lose", "drain", "degen"];
/** Whole words only (see hasWord): "heal" is also the start of "health", which must not count as a heal. */
const healWords = ["heal", "heals", "healing", "regen", "restore", "restored", "lifesteal", "gain", "gained"];
const healthWords = ["health", "hp", "life"];
/** Only "mana": "mp" would also match stomp, jump, impact... */
const manaWords = ["mana"];
/** How a value says it is per point of a pool, when it is not a % (damage_per_health, "damage per missing mana"). */
const perPoolWords = ["per_health", "per_mana", "per_missing", "missing", "per_point", "per health", "per mana", "per point"];

/** What a profile needs to know about the stat. */
export interface StatFacts {
    abilityName: string;
    /** AbilityValues key, or cooldown / casttime / manacost / castrange */
    statKey: string;
    kind: UpgradeKind;
    /** Level-1 number */
    base: number;
    /** "up" = bigger is better */
    direction: "up" | "down";
    ultimate: boolean;
    /** Level-1 cooldown of the skill in seconds (0 = none, e.g. passives) */
    cooldown: number;
    /** Dota's tooltip label for the value, lowercase, without the "%" (tooltip_data.ts); "" if unknown */
    tooltip: string;
    /** Dota shows the value as a percentage (its tooltip label starts with "%"), or its name says so */
    percent: boolean;
    /** The tooltip itself shows a "%" (false when there is no tooltip label) */
    percentShown: boolean;
}

/**
 * Damage per click also depends on how often the skill can hit: a nuke on a long cooldown gets bigger clicks than one
 * that is up every few seconds. 12 s is neutral; the factor stays between 0.75 and 1.4.
 */
function cooldownFactor(cooldown: number): number {
    if (cooldown <= 0) return 1;
    return math.min(math.max(math.sqrt(cooldown / 12), 0.75), 1.4);
}

/** The kind of damage a damage stat is: they grow differently. */
function damageProfile(facts: StatFacts, lower: string): StatProfile {
    const cd = cooldownFactor(facts.cooldown);
    // A share of something else (bonus damage %): at most 100
    if (facts.percent && math.abs(facts.base) <= 100) {
        return { type: "damage %", step: 1, minimum: 1, maxValue: 100, maxMultiple: 4 };
    }
    // Crit multipliers are already big percentages (200 = double damage): up to twice as big. Also caught by the
    // tooltip (Dawnbreaker Luminosity's "bonus_damage" is a "Critical strike damage").
    if (lower.includes("crit") || facts.tooltip.includes("crit")) return { type: "crit", step: 0.5, minimum: 5, maxMultiple: 2 };
    // Damage per something that already grows (per stack, per soul, per intelligence, Strength damage...): the
    // total is this number times a count that climbs all game, so the number itself gets little room
    const perSomething = lower.includes("_per_") && !has(lower, ["per_second", "per_sec", "per_tick", "per_hit"]);
    if (perSomething || has(lower, ["strength_damage", "agility_damage", "intellect_damage", "intelligence_damage"])) {
        return { type: "scaling damage", step: 0.5, minimum: 0.5, maxMultiple: 3 };
    }
    // Over time: per second, per tick, burns
    if (has(lower, ["per_second", "per_sec", "dps", "per_tick", "_tick", "burn", "damage_per", "poison", "bleed"])) {
        return { type: "damage over time", step: 1 * cd, minimum: 3, maxMultiple: facts.ultimate ? 6 : 10 };
    }
    // Cleave: a share of the hit
    if (lower.includes("cleave")) return { type: "cleave", step: 1, minimum: 2, maxValue: 100, maxMultiple: 4 };
    // On attacks: bonus damage per hit
    if (has(lower, ["attack", "per_hit", "on_hit", "hit_damage"])) {
        return { type: "attack damage", step: 1, minimum: 5, maxMultiple: 8 };
    }
    // One-off damage: nukes. Ultimates start high, so they get less room but bigger smallest clicks.
    return facts.ultimate
        ? { type: "nuke (ultimate)", step: 1 * cd, minimum: 20, maxMultiple: 8 }
        : { type: "nuke", step: 1 * cd, minimum: 10, maxMultiple: 15 };
}

/** The profile of a stat whose smaller number is the better one. */
function lowerIsBetterProfile(facts: StatFacts, lower: string): StatProfile {
    if (facts.kind === "manacost" || has(lower, ["manacost", "mana_cost"])) {
        return { type: "mana cost", step: 0.5, minimum: 5, lowest: 0.3, maxRarity: "rare" };
    }
    if (facts.kind === "cooldown" || has(lower, ["cooldown", "restore_time", "restoretime"])) {
        return { type: "cooldown", step: 0.5, minimum: 0.25, lowest: 0.4 };
    }
    if (facts.kind === "casttime") return { type: "cast point", step: 0.75, minimum: 0.05, lowest: 0.25 };
    if (has(lower, ["tick", "interval"])) return { type: "tick rate", step: 0.5, minimum: 0.05, lowest: 0.4 };
    if (has(lower, ["cost"])) return { type: "cost", step: 0.5, minimum: 5, lowest: 0.3 };
    return { type: "delay", step: 0.5, minimum: 0.05, lowest: 0.4 };
}

/** The limits and click size of one stat. `ruleCap` is a skill rule's own highest multiple, if it has one. */
export function statProfile(facts: StatFacts, ruleCap?: number, ruleCeiling?: number): StatProfile {
    const profile = typedProfile(facts, ruleCap);
    // A skill rule's own absolute ceiling (Maledict 120%) replaces the type's ceilings, "+40 at most" included
    if (ruleCeiling !== undefined) {
        profile.maxValue = ruleCeiling;
        profile.maxAdd = undefined;
        profile.maxMultiple = undefined;
    }
    return profile;
}

function typedProfile(facts: StatFacts, ruleCap?: number): StatProfile {
    const profile = baseProfile(facts);
    if (ruleCap !== undefined) profile.maxMultiple = math.min(profile.maxMultiple ?? ruleCap, ruleCap);
    // The smallest click is a number in the stat's unit (10 damage, 0.1 s): on a small number it would be a huge jump
    // (a 0.8% health decay got +2.8 per click). So it is never more than a quarter of the stat's own level-1 number.
    const size = math.abs(facts.base);
    if (size > 0) profile.minimum = math.min(profile.minimum, size * MAX_MINIMUM_SHARE);
    // Whatever its type, a value Dota shows as a percentage stays a sane percentage: at most 100% when it starts at or
    // below 100, at most 5x when it starts above (Nyx's Spiked Carapace reflects over 100%; as plain "damage" it
    // could reach 1036%). Above 100 it is exactly 5x whatever the type (crits and Sven's 110% too, user 2026-09-29:
    // the small clicks make that ceiling slow to reach), unless a per-skill rule caps lower. Pool damage keeps its own
    // fixed clicks and caps.
    if (facts.percent && facts.direction === "up" && size > 0 && profile.rarityClicks === undefined && !isCountValue(facts.statKey)) {
        if (size <= 100) profile.maxValue = math.min(profile.maxValue ?? 100, 100);
        // Above 100 only when Dota itself shows a "%" (Ursa's 400 "pct" attack speed is not one): else its own type
        else if (!facts.percentShown) return profile;
        else {
            profile.maxMultiple = math.min(PERCENT_ABOVE_100_MULTIPLE, ruleCap ?? PERCENT_ABOVE_100_MULTIPLE);
            // Its name may say "damage" (Spiked Carapace's damage_reflect_pct was listed as a "nuke"); crits keep theirs
            if (profile.type !== "crit") profile.type = "percent (above 100)";
        }
        // And it moves by whole points per click like pool damage (user: Spiked Carapace went +20% per click)
        profile.rarityClicks = percentClicks(size);
    }
    return profile;
}

function baseProfile(facts: StatFacts): StatProfile {
    const { abilityName, statKey, kind, base } = facts;
    const lower = statKey.toLowerCase();
    const size = math.abs(base);

    // Miss and blind as whole words: "missile" (Gyrocopter, Tinker, Vengeful Spirit's Magic Missile stun) is not a miss
    // chance. Names that are a time (blind_duration, a damage-reduction shield's duration) go by their time instead.
    const nameWords = lower.split("_");
    const isTimeName = has(lower, ["duration", "time"]);
    const isMiss = (nameWords.includes("miss") || nameWords.includes("blind")) && !isTimeName;

    // Proc chance (bash, crit, Time Lock...), either direction: fixed +1 / 2 / 4 points on rare / epic / legendary rows
    // (never common), at most +60 points and never above 80% (user 2026-09-29). A chance MULTIPLIER (Razor's Shard 2x)
    // is not a chance.
    if (lower.includes("chance") && !isMiss && !lower.includes("multiplier") && size <= 100) {
        return { type: "proc chance", step: 0, minimum: 0, rarityClicks: [1, 1, 2, 4], maxAdd: 60, maxValue: 80, minRarity: "rare" };
    }
    if (facts.direction === "down") return lowerIsBetterProfile(facts, lower);
    if (kind === "castrange") return { type: "cast range", step: 0.4, minimum: 20, maxMultiple: 1.75 };

    const group = statGroup(abilityName, statKey);
    const isSummon = summonWords.some(word => lower.includes(word) || abilityName.includes(word));

    // Whole numbers: +1 per click whatever the size (see upgrade_engine), so only the ceiling matters here
    if (isCountValue(statKey) || group === "Count") {
        return { type: isSummon ? "unit count" : "count", step: 1, minimum: 1, maxMultiple: isSummon ? 2 : 4 };
    }
    // The damage, health and armor of creeps, summons or illusions: up to 8x (user 2026-09-29, was 2x). Their COUNT
    // stays at 2x above: more units is what snowballs and lags the game. Anything else about them (a skeleton's radius,
    // a boulder's distance, a lifetime) goes by its own type below: 8x would take a 1200 radius to 9600.
    const aboutUnits = unitWords.some(word => lower.includes(word));
    const isReach = has(lower, ["radius", "range", "distance", "speed", "width", "offset"]);
    if (aboutUnits && has(lower, ["damage", "dmg", "health", "hp", "armor", "attack"]) && !isTimeName && !isReach) {
        return { type: "unit stat", step: 1, minimum: 0, maxMultiple: 8 };
    }

    // Chances and shares with their own ceilings (checked before damage: "damage_reduction" is not damage)
    if (isMiss && size <= 100) return { type: "miss chance", step: 1.5, minimum: 2, maxValue: 75 };
    const isReduction = has(lower, ["damage_reduction", "reduction_pct", "dmg_reduction"]) || (lower.includes("incoming") && lower.includes("damage"));
    if (isReduction && !isTimeName && size <= 100) return { type: "damage reduction", step: 1.5, minimum: 2, maxValue: 80 };

    const percent = facts.percent && size <= 100;

    // Damage from a health or mana pool: it already grows with the pool (bigger heroes late game), so a buff on top
    // compounds two growths. Small clicks, at most double. Checked before the other damage kinds and before
    // "Heal & defense", which would otherwise take it because of the word "health".
    const text = `${lower} ${facts.tooltip}`;
    // A % of a pool, per point of a pool, or a value NAMED after a pool (Huskar's Life Break "health_damage" 0.32)
    const namedAfterPool = has(lower, poolDamageWords) && (has(lower, healthWords) || has(lower, manaWords));
    const poolBased = percent || has(text, perPoolWords) || namedAfterPool;
    if (poolBased && has(text, poolDamageWords) && !hasWord(text, healWords)) {
        const kind = has(text, healthWords) ? "health-pool damage" : has(text, manaWords) ? "mana-pool damage" : undefined;
        // A % of a pool: fixed clicks per rarity and a fixed most-you-can-add, the same at every skill level (user's
        // numbers). Small ones (Heartstopper 0.8%/s) move 0.1..0.5 points, up to +8; big ones (Elder Titan 34%) 1..5
        // points, up to +40
        if (kind !== undefined && percent) {
            const big = size >= BIG_POOL_PERCENT;
            return {
                type: `${kind} %${big ? " (big)" : ""}`,
                step: 0,
                minimum: 0,
                rarityClicks: percentClicks(size),
                maxAdd: big ? 40 : 8,
                maxValue: 100,
            };
        }
        if (has(text, healthWords)) return { type: "health-pool damage", step: 0.5, minimum: 0.1, maxMultiple: 2 };
        if (has(text, manaWords)) return { type: "mana-pool damage", step: 0.5, minimum: 0.1, maxMultiple: 2 };
    }

    // The tooltip counts too: Vengeful Spirit's "magic_missile_stun" is a "Stun duration"
    const isDuration = has(lower, ["duration", "time", "linger", "window"]) || facts.tooltip.includes("duration");
    // "Disable" is picked by words like stun or bash, so a bash's damage or a stun's radius land there too: only its
    // durations are disables, the rest goes by what the name says
    const byName = group === "Disable" && !isDuration;
    // A name that says "damage" wins over the group even outside "Disable" (statGroup can file damage under
    // Heal & defense because of a word like "health"), unless the name ENDS as a time: damage_duration, damage_window
    // and damage_debuff_duration are durations, not damage
    const endsAsTime = lower.endsWith("duration") || lower.endsWith("_time") || lower.endsWith("window") || lower.endsWith("_delay");
    // The same for a name that ENDS as a reach: damage_radius, explosion_radius, bonus_damage_distance are an area or a
    // distance (Abaddon's Shard "return damage radius" 675 was a 15x nuke -> 10125)
    // (or STARTS with "radius" without naming damage: Tinker's "radius_explosion")
    const endsAsArea = lower.endsWith("radius") || lower.endsWith("_aoe") || lower.endsWith("area_of_effect") ||
        (lower.startsWith("radius_") && !has(lower, ["damage", "dmg"]));
    const endsAsReach = endsAsArea || lower.endsWith("distance") || lower.endsWith("range") || lower.endsWith("width");
    if (!endsAsTime && !endsAsReach && (group === "Damage" || has(lower, ["damage", "dmg"]))) return damageProfile(facts, lower);

    if (isDuration && (has(lower, disableWords) || disableSkills.includes(abilityName) || group === "Disable")) {
        return { type: "disable", step: 1, minimum: 0.1, maxMultiple: 5 };
    }
    if (group === "Duration" || isDuration) return { type: "duration", step: 1, minimum: 0.25, maxMultiple: 8 };

    if (group === "Area" || endsAsArea || lower.endsWith("width") || (byName && has(lower, ["radius", "aoe", "area", "width"]))) {
        // Widths (of a hook, a wave) would look silly at 1200: they keep a multiple
        if (lower.includes("width")) return { type: "width", step: 0.5, minimum: 8, maxMultiple: 3 };
        return facts.ultimate
            ? { type: "area (ultimate)", step: 0.5, minimum: 8, maxValue: 2400 }
            : { type: "area", step: 0.5, minimum: 8, maxValue: 1200 };
    }
    const endsAsDistance = lower.endsWith("distance") || lower.endsWith("range");
    if (group === "Range & distance" || endsAsDistance || (byName && has(lower, ["range", "distance"]))) return { type: "range", step: 0.5, minimum: 20, maxMultiple: 2 };
    if (group === "Slow") {
        // A slow per stack, per hit or per unit (Void Time Dilation 4 per stack, Dazzle 2.5 per hit) adds up: at most +8
        // points on the number itself (user 2026-09-29), like the small pool damage
        const perSomething = has(text, ["per_", " per "]) && !has(text, ["per_second", "per_sec", "per second"]);
        if (perSomething) return { type: "slow per stack", step: 1, minimum: 1, maxAdd: 8, maxValue: percent ? 80 : undefined };
        return percent ? { type: "slow %", step: 1, minimum: 2, maxValue: 80 } : { type: "slow", step: 1, minimum: 5, maxMultiple: 4 };
    }
    if (group === "Speed") return { type: "speed", step: 1, minimum: 5, maxMultiple: 4, maxValue: percent ? 100 : undefined };
    if (group === "Heal & defense") {
        if (percent) return { type: "heal/defense %", step: 1, minimum: 1, maxValue: 100, maxMultiple: 6 };
        return { type: "heal/defense", step: 1, minimum: lower.includes("armor") ? 1 : 3, maxMultiple: 6 };
    }
    if (percent) return { type: "percent", step: 1, minimum: 1, maxValue: 100, maxMultiple: 6 };
    return { type: "other", step: 1, minimum: 0, maxMultiple: 6 };
}

/** The lowest a skill value may ever be pushed, as a multiple of its normal number at the current level. */
export function floorOf(option: UpgradeOption): number {
    return option.direction === "down" ? option.limits.lowest ?? 0.4 : BAD_WAY_LOWEST;
}

/**
 * The lowest and highest power a stat may have right now. Power is the change as a share of the level-1 number.
 * `levelRatio` is the size of the number at the ability's current level divided by the level-1 number, since absolute
 * ceilings and floors apply to the number the player really has.
 */
export function powerRange(option: UpgradeOption, levelRatio: number, unlock = capUnlock()): { low: number; high: number } {
    const limits = option.limits;
    const size = math.abs(option.base);
    if (option.direction === "down") {
        const lateLow = ((limits.lowest ?? 0.4) - 1) * levelRatio;
        return { low: lateLow * unlock, high: BAD_WAY_HIGHEST - 1 };
    }
    let lateHigh = math.huge;
    if (limits.maxMultiple !== undefined) lateHigh = limits.maxMultiple - 1;
    if (limits.maxValue !== undefined && size > 0) lateHigh = math.min(lateHigh, (limits.maxValue - size * levelRatio) / size);
    if (limits.maxAdd !== undefined && size > 0) lateHigh = math.min(lateHigh, limits.maxAdd / size);
    if (lateHigh === math.huge) lateHigh = 5;
    return { low: (BAD_WAY_LOWEST - 1) * levelRatio, high: math.max(lateHigh, 0) * unlock };
}
