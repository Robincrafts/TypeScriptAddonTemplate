import { config } from "./config";
import { reviewKept, reviewRemoved } from "./review_rules";
import { statGroup } from "./stat_types";

// Rules that keep single skills from getting silly. Everything here is about WHICH stats may be modified; how far
// each kind of stat may go is in stat_limits.ts (a skill rule's own cap below still wins over it).
// To handle a problem skill, add one entry to `skillRules` below.

export interface SkillRule {
    /** The whole skill is never offered */
    skip?: boolean;
    /** Value names (matched as lowercase substrings) that are never offered */
    blockValues?: string[];
    /**
     * Only skills with this entry get cast range rows. `pairedValue` is the AbilityValues key that really decides how
     * far the skill reaches (raised together with the range); `cap` is the highest multiple of the original range.
     */
    castRange?: { pairedValue?: string; cap?: number };
    /** Value names (substring match) -> highest multiple of the original number. 1 = locked. Replaces the automatic caps. */
    caps?: Record<string, number>;
    /**
     * Exact value names -> highest the number may ever reach, at any level (e.g. Maledict 120). Replaces the stat type's
     * ceiling, also a pool damage's "+40 at most".
     */
    ceilings?: Record<string, number>;
    /**
     * Most a count of this skill (whole-number value) may be raised above its normal number (Cataclysm: +2). Replaces
     * the usual count ceiling (4x), so it can also allow more (Supernova: +30).
     */
    countMaxAdd?: number;
    /** The same for single counts by exact value name, when the skill's other counts keep the usual ceiling */
    valueMaxAdds?: Record<string, number>;
    /**
     * Values (substring match on the name) that only work with Aghanim's Scepter or Shard when the KV does not say so,
     * and for Invoker only with the Scepter option the player took (1 Quas / 2 Wex / 3 Exort, invokerScepterOption)
     */
    itemValues?: { word: string; item: "scepter" | "shard"; option?: number }[];
    /** Value names (substring match) where a smaller number is better although the name does not say "cost" */
    lowerValues?: string[];
    /**
     * Value names or "manacost" / "cooldown" (substring match) -> the lowest multiple of its normal number it may be
     * lowered to, by either button (0.8 = at most 20% lower). Tighter than the stat type's own floor.
     */
    floors?: Record<string, number>;
}

/** A skill rule's floor for one stat (value name or generic kind), if it has one. */
export function floorRule(abilityName: string, statKey: string): number | undefined {
    const floors = skillRules[abilityName]?.floors;
    if (floors === undefined) return undefined;
    const lower = statKey.toLowerCase();
    for (const key in floors) {
        if (lower.includes(key)) return floors[key];
    }
}

export const skillRules: Record<string, SkillRule> = {
    // Cast range buffs: only these skills, where reach really matters
    pudge_meat_hook: { castRange: {} },
    magnataur_skewer: { castRange: {} }, // reach comes from its "range" value, found automatically
    mirana_arrow: { castRange: { pairedValue: "arrow_range" } },
    mars_spear: { castRange: { pairedValue: "spear_range" } },
    kunkka_tidal_wave: { castRange: {} },
    // Leftover from an old Pudge Shard: the Shard now upgrades Meat Hook, and this value does nothing
    pudge_dismember: { blockValues: ["shard_regen_pct"] },
    // A longer prison and a bigger mana steal would be miserable to play against
    obsidian_destroyer_astral_imprisonment: { caps: { duration: 1.5, steal: 1, capacity: 1 } },
    // Health-pool damage ceilings (user 2026-09-29): Rupture 10% -> 20%, Maledict 16..40% -> 120%, Earth Splitter -> 100%
    bloodseeker_rupture: { ceilings: { hp_pct: 20 } },
    witch_doctor_maledict: { ceilings: { bonus_damage: 120 } },
    elder_titan_earth_splitter: { ceilings: { damage_pct: 100 } },
    // Shatter threshold: 12% -> 72% would execute heroes at most of their health (user 2026-09-29: 2x)
    ancient_apparition_ice_blast: { caps: { kill_pct: 2 } },
    // Invoker's Scepter has three options (user 2026-09-30, Scepter tooltip): 1 Quas -> Ice Floe, 2 Wex -> Tornado
    // twisters, 3 Exort -> Cataclysm. Their values carry no RequiresScepter flag, so Cataclysm was offered without a
    // Scepter. Only the option the player took is offered (upgrade_engine invokerScepterOption).
    invoker_ice_wall: { itemValues: [{ word: "glacier", item: "scepter", option: 1 }] },
    invoker_tornado: { itemValues: [{ word: "twister", item: "scepter", option: 2 }] },
    // Cataclysm's number of Sun Strikes: at most +2 (user 2026-09-30)
    invoker_sun_strike: { itemValues: [{ word: "cataclysm", item: "scepter", option: 3 }], countMaxAdd: 2 },
    // Supernova's attacks to destroy the egg: a count (epic and legendary rows), at most +30 (user 2026-09-30).
    // The Scepter version keeps the usual count ceiling (user: not the same cap)
    phoenix_supernova: { valueMaxAdds: { max_hero_attacks: 30 } },
    // Tinker's innate Eureka (item cooldown reduction from intelligence, up to 60%): never buffed (user 2026-09-30)
    tinker_eureka: { skip: true },
    // Ball Lightning's mana costs decide how far Storm Spirit can zip: cheaper zips snowball, so they may drop by at
    // most 20% (user 2026-09-30: "nerf a bit hard"). The initial cost values are costs too, though not named so.
    storm_spirit_ball_lightning: {
        lowerValues: ["initial_mana"],
        floors: { manacost: 0.8, initial_mana: 0.8, travel_cost: 0.8 },
    },
};

/**
 * Cast point buffs (epic and legendary rows only): only these skills, where a faster cast decides whether a
 * skillshot lands or a disable goes off before the enemy reacts. Names checked against the all-hero audit.
 */
export const castPointSkills = [
    // Skillshots
    "pudge_meat_hook", "mirana_arrow", "earthshaker_fissure", "lina_light_strike_array", "kunkka_torrent",
    "sandking_burrowstrike", "tiny_avalanche", "ancient_apparition_ice_blast", "skywrath_mage_mystic_flare",
    // Instant disables
    "lion_voodoo", "lion_impale", "shadow_shaman_voodoo", "sven_storm_bolt", "vengefulspirit_magic_missile",
    "crystal_maiden_frostbite", "batrider_flaming_lasso",
    // Big ultimates
    "magnataur_reverse_polarity", "tidehunter_ravage", "enigma_black_hole", "faceless_void_chronosphere",
    "puck_dream_coil", "lina_laguna_blade",
    // Long cast points
    "sniper_assassinate", "legion_commander_duel", "doom_bringer_doom",
];

/**
 * Value names that are never offered, whatever the skill (lowercase substrings). From the all-hero audit (2026-09-27).
 */
const uselessWords = [
    // Chance-to-proc is allowed (host toggle allowProcChance); avoidance stats stay hidden always
    "dodge", "evasion", "evade",
    // Gold and XP the ENEMY gets for killing your units
    "gold_bounty", "xp_bounty", "bounty_gold", "bounty_xp", "familiar_bounty", "illusion_bounty",
    // How much damage your own images take (Grimstroke, Ringmaster, Shadow Shaman chickens): a buff would hurt you
    "take_damage",
    // Cosmetic
    "animation", "model_scale", "modelscale", "render", "fx_", "visual", "particle", "hull",
    // Channel time: longer is good for some skills and bad for others (Tinker's Rearm, teleports)
    "channeltime", "channel_time", "channel_duration",
    // Illusion INCOMING damage (Phantasm, Juxtapose, Replicate, Wall of Replica, Bane's Scepter...): defaults around
    // 300% (illusions take extra damage by design). We have no per-stat "down is better" override for these, so our
    // default direction ("up") would advertise raising it as a buff, which only makes the player's own illusions
    // more fragile. Outgoing damage and damage REDUCTION for illusions are unaffected (both fine to buff).
    "incoming_damage", "damage_incoming", "damage_in_pct", "illusion_incoming", "incoming_illusion",
    // Which damage type a skill deals (pure_damage_type = 1): a switch, not an amount
    "damage_type",
];

/** On/off switches stored as 1 = yes: raising them does nothing (value name starts with one of these). */
const switchPrefixes = ["has_", "can_", "does_", "should_", "is_", "applies_", "apply_", "unlimited_", "show_"];
/** Switches whose names do not follow the prefixes above ("give_" is not a prefix: give_up_distance is a real distance). */
const switchNames = [
    "spawn_pit_on_cast", "spawn_zombie_on_attack", "primal_split_cancel", "activation_disable_turning",
    "activation_ignore_cast_angle", "invis_rune", "arcane_rune", "haste_rune", "give_brawler_passive", "give_wolves_hightail",
    // Not a switch, but gold for the enemy: Arc Warden's Tempest Double bounty
    "bounty",
];

/** Counts of targets, charges, bounces...: more of them snowballs fast, so they are capped at COUNT_CAP. */
const countWords = [
    "targets", "charges", "bounces", "jumps", "instances", "count", "stack_limit", "max_stacks", "total_attacks",
    "max_attacks", "strikes", "pulses", "spirits", "stacks_per",
    // Hits needed to destroy a unit (Phoenix Supernova, Lich Ice Spire, user 2026-09-30)
    "hero_attacks",
];

/**
 * Whether a value is a count (targets, charges, bounces, summon counts...): whole numbers only, so it moves by
 * exactly 1 per click, is rounded to a whole number, and is only offered on epic or legendary rows.
 */
// Cached: the boost modifier asks isCountValue on every ability value lookup
const countValueCache: Record<string, boolean> = {};

export function isCountValue(valueName: string): boolean {
    let result = countValueCache[valueName];
    if (result === undefined) {
        const lower = valueName.toLowerCase();
        result = countWords.some(word => lower.includes(word)) || isTickCount(valueName);
        countValueCache[valueName] = result;
    }
    return result;
}

/** Words in a value name that mark a disable (stun, root, silence...). Their durations get the tighter cap. */
export const disableWords = ["stun", "root", "silence", "hex", "sleep", "fear", "disable", "taunt", "cyclone", "imprison", "mute", "entangle", "ensnare", "paralysis"];

/** Skills whose plain "duration" value is a disable. */
export const disableSkills = [
    "lion_voodoo",
    "shadow_shaman_voodoo",
    "lion_impale",
    "sven_storm_bolt",
    "axe_berserkers_call",
    "faceless_void_chronosphere",
    "enigma_black_hole",
    "legion_commander_duel",
    "doom_bringer_doom",
    "bane_fiends_grip",
    "bane_nightmare",
    "batrider_flaming_lasso",
    "pudge_dismember",
    "shadow_shaman_shackles",
    "treant_overgrowth",
    "crystal_maiden_frostbite",
    "naga_siren_song_of_the_siren",
    "sandking_burrowstrike",
    "tidehunter_ravage",
    "magnataur_reverse_polarity",
    "dragon_knight_dragon_tail",
];

/** Words that mark a summon, in a value or skill name: its count keeps the summon cap. */
export const summonWords = [
    "summon", "spawn", "creep", "illusion", "treant", "spider", "eidolon", "wolf", "wolves", "golem", "zombie",
    "skeleton", "familiar", "serpent", "ward", "hawk", "raptor", "boar", "razorback",
];
/** Words that mark anything about creeps, summons or illusions (their number, damage, health...): capped low. */
export const unitWords = ["creep", "summon", "spawn", "unit", "illusion", "treant", "spiderling", "spider", "eidolon", "wolf", "wolves", "golem", "zombie", "skeleton", "familiar", "serpent", "ward_count", "max_count", "count"];

export interface ValueLimit {
    /** Never offer this value */
    hidden: boolean;
    /** The skill rule's own highest multiple of the original number, if it has one (wins over stat_limits.ts) */
    cap?: number;
    /** The skill rule's own absolute ceiling for the number, if it has one (wins over stat_limits.ts) */
    ceiling?: number;
    /** The skill rule's most-you-can-add for the number, if it has one */
    maxAdd?: number;
}

/** Decides whether an ability value may be modified at all, and the skill rule's own cap for it. */
export function limitFor(abilityName: string, valueName: string): ValueLimit {
    const lower = valueName.toLowerCase();
    const rule = skillRules[abilityName];

    if (uselessWords.some(word => lower.includes(word))) return { hidden: true };
    if (switchPrefixes.some(prefix => lower.startsWith(prefix)) || switchNames.includes(lower)) return { hidden: true };
    if (rule?.blockValues?.some(word => lower.includes(word))) return { hidden: true };

    const ceiling = rule?.ceilings?.[valueName];
    const countMaxAdd = rule?.valueMaxAdds?.[valueName] ?? rule?.countMaxAdd;
    const maxAdd = countMaxAdd !== undefined && isCountValue(valueName) ? countMaxAdd : undefined;
    // The skill's own cap wins over the stat type's (stat_limits.ts); a cap of 1 locks the value
    if (rule?.caps !== undefined) {
        for (const key in rule.caps) {
            if (lower.includes(key)) return rule.caps[key] <= 1.0001 ? { hidden: true } : { hidden: false, cap: rule.caps[key], ceiling, maxAdd };
        }
    }
    return { hidden: false, ceiling, maxAdd };
}

// --- Removed stats ---
// Global rules first decide what no hero gets; the Buff Stat Review (review_rules.ts, generated) overrides them per stat.

/** Parts of a value name (split at "_") that mark physics, animation or timing tuning: they change feel, not power. */
const tuningParts = [
    "acceleration", "height", "gravity", "offset", "vector", "buffer", "think", "animation", "visual", "particle",
    "model", "scale", "fx", "lowest", "hop", "tolerance", "update",
];
/** Pieces anywhere in a value name that the user removed for every hero. */
const removedPieces = ["give_up"];

/** More starts of value names that are on/off switches (next to switchPrefixes above, which hides them earlier). */
const moreSwitchPrefixes = ["trigger_", "affects_", "use_", "can_", "is_", "does_", "allow", "destroy_", "double_"];

/** Whether a value is removed for every hero, whatever the skill. */
function removedGlobally(valueName: string): boolean {
    const lower = valueName.toLowerCase();
    if (removedPieces.some(piece => lower.includes(piece))) return true;
    const parts = lower.split("_");
    if (parts.some(part => tuningParts.includes(part))) return true;
    // On/off switches written as numbers
    if (moreSwitchPrefixes.some(prefix => lower.startsWith(prefix))) return true;
    if (lower.includes("activatable") || lower.endsWith("_enabled")) return true;
    return false;
}

/** How often a skill ticks ("tick_rate", "immolate_tick", "total_ticks"), but not damage or points per tick. */
function isTickStat(valueName: string): boolean {
    const lower = valueName.toLowerCase();
    if (lower.includes("per_tick") || isTickCount(valueName)) return false;
    const parts = lower.split("_");
    return lower.includes("tick_rate") || lower.includes("tickrate") || lower.includes("tick_interval") || parts[parts.length - 1] === "tick";
}

/**
 * A NUMBER of ticks (Pudge Dismember "ticks", Maledict "ticks", "total_ticks", "tick_count"): a count, not a tick rate.
 * +1 per click and only on legendary rows (user 2026-09-29): one more tick is a whole extra hit of the skill.
 */
export function isTickCount(valueName: string): boolean {
    const lower = valueName.toLowerCase();
    return lower.split("_").includes("ticks") || lower.includes("tick_count");
}

/** Stats removed by hand after the review (review_rules.ts is generated, so they live here). */
const manualRemoved: Record<string, boolean> = {
    "invoker_invoke|max_invoked_spells": true,
    // Leftovers of an older Fan of Knives (no tooltip; the skill uses pct_health_damage_initial and Break now)
    "phantom_assassin_fan_of_knives|pct_health_damage": true,
    "phantom_assassin_fan_of_knives|degen": true,
    // Ball Lightning's "blocker_duration": no Dota tooltip, an internal timing a player cannot feel (user 2026-09-30)
    "storm_spirit_ball_lightning|blocker_duration": true,
};

/** Whether one stat of one skill is never offered: the review's decision if it has one, otherwise the global rules. */
export function isRemovedStat(abilityName: string, statKey: string): boolean {
    const key = `${abilityName}|${statKey}`;
    if (manualRemoved[key]) return true;
    // Tick rates follow the host toggle only: the review removed them back when they were off for everyone
    if (isTickStat(statKey)) return false;
    if (reviewRemoved[key]) return true;
    if (reviewKept[key]) return false;
    return removedGlobally(statKey);
}

// --- Kinds of buffs the host can switch on (setup menu, Skills > Buff types; all off by default) ---

const durationWords = ["duration", "time"];
const unitCountWords = ["max_", "num_", "number", "count"];
const moreUnitWords = ["image", "soldier"];

/** A count of units or illusions a skill makes (illusion_count, max_treants, num_first_soldiers...). */
function isUnitCount(abilityName: string, lower: string): boolean {
    const isUnit = [...summonWords, ...moreUnitWords].some(word => lower.includes(word) || abilityName.includes(word));
    return isUnit && (isCountValue(lower) || unitCountWords.some(word => lower.includes(word)));
}

/** Whether a stat is switched off by one of the host's buff-type toggles. */
export function blockedBySettings(abilityName: string, statKey: string): boolean {
    const lower = statKey.toLowerCase();
    const group = statGroup(abilityName, statKey);
    const isDuration = durationWords.some(word => lower.includes(word));
    // Enemy debuffs: how long disables last, slows (amount and duration), lingering effects and knockbacks
    const isDebuff =
        (group === "Disable" && isDuration) ||
        group === "Slow" ||
        ["slow_duration", "linger", "knockback_duration"].some(word => lower.includes(word));
    if (config.allowDebuffs !== 1 && isDebuff) return true;
    // The skill's own effect lasting longer (empower, Stone Gaze, Rolling Thunder...)
    if (config.allowSkillDurations !== 1 && group === "Duration") return true;
    if (config.allowUnitCounts !== 1 && isUnitCount(abilityName, lower)) return true;
    if (config.allowTurnRate !== 1 && lower.includes("turn_rate")) return true;
    if (config.allowTickRate !== 1 && isTickStat(statKey)) return true;
    if (config.allowProcChance !== 1 && lower.includes("chance")) return true;
    return false;
}
