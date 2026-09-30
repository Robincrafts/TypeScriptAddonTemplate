// What kind of buff a stat is (damage, disable, area...): used for the variety rule of the list and by the stat
// profiles in stat_limits.ts. The kinds match the Buff Stat Review page; the review's hand-set groups win.
import { reviewGroups } from "./review_rules";

export type StatGroup =
    | "Damage"
    | "Disable"
    | "Duration"
    | "Area"
    | "Range & distance"
    | "Cost & cooldown"
    | "Heal & defense"
    | "Slow"
    | "Speed"
    | "Count"
    | "Other";

const has = (lower: string, words: string[]) => words.some(word => lower.includes(word));

// First match wins, so the order matters (stun_duration is a Disable before it is a Duration)
const groupRules: [StatGroup, (lower: string) => boolean][] = [
    ["Cost & cooldown", k => has(k, ["manacost", "mana_cost", "cooldown", "casttime", "cast_point", "castpoint", "charge_restore", "restore_time", "health_cost", "hp_cost"])],
    ["Disable", k => has(k, ["stun", "root", "silence", "hex", "sleep", "fear", "disable", "taunt", "cyclone", "imprison", "mute", "entangle", "ensnare", "paralysis", "disarm", "break_duration", "bash", "sheep", "banish"])],
    ["Count", k => has(k, ["targets", "charges", "bounces", "bounce", "jumps", "instances", "count", "max_stacks", "stack_limit", "max_units", "number_of", "num_", "_num", "total_attacks", "max_attacks", "hero_attacks", "strikes", "pulses", "spirits", "stacks_per"])],
    ["Heal & defense", k => has(k, ["heal", "regen", "armor", "shield", "absorb", "barrier", "lifesteal", "life_steal", "evasion", "block", "resist", "incoming", "damage_reduction", "reduction_pct", "hp_", "bonus_hp", "health", "max_hp", "restore"])],
    ["Damage", k => has(k, ["damage", "dps", "dmg", "crit", "cleave", "burst", "nuke", "explosion", "attack_bonus", "bonus_attack", "spell_amp"])],
    ["Slow", k => has(k, ["slow", "ms_reduction", "movespeed_reduction", "as_reduction", "attack_speed_reduction", "speed_reduction"])],
    ["Speed", k => has(k, ["movespeed", "move_speed", "movement_speed", "attack_speed", "bonus_speed", "speed_bonus", "bonus_ms", "bonus_as"]) || k.endsWith("_as") || k.endsWith("_ms")],
    ["Area", k => has(k, ["radius", "aoe", "width", "area", "spread", "splash"])],
    ["Range & distance", k => has(k, ["range", "distance", "vision", "sight", "leash", "reach"])],
    ["Duration", k => has(k, ["duration", "time", "linger", "lifetime"])],
];

/** The kind of buff a stat is. `statKey` is the AbilityValues key, or manacost / cooldown / casttime / castrange. */
export function statGroup(abilityName: string, statKey: string): StatGroup {
    const reviewed = reviewGroups[`${abilityName}|${statKey}`];
    if (reviewed !== undefined) return reviewed as StatGroup;
    if (statKey === "castrange") return "Range & distance";
    const lower = statKey.toLowerCase();
    for (const [group, test] of groupRules) {
        if (test(lower)) return group;
        // After Disable: any other "...duration" is a Duration, not the Damage/Heal it names (burn_duration)
        if (group === "Disable" && lower.endsWith("duration")) return "Duration";
    }
    return "Other";
}

