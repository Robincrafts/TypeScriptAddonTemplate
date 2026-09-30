/**
 * Ability boost data shared between VScripts (server + client-side modifier code) and Panorama.
 * Multipliers are relative to the ability's base value (1 = unchanged).
 */

interface AbilityBoost {
    /** Cooldown multiplier, e.g. 0.5 = half the cooldown */
    cooldown?: number;
    /** Cast point multiplier, e.g. 0.5 = half the cast point */
    casttime?: number;
    /** Mana cost multiplier */
    manacost?: number;
    /** Flat cast range bonus */
    castrange?: number;
    /** Multiplier per ability value name (AbilityValues key), e.g. { damage: 2 }. Used for linked values (vision, reach). */
    values?: Record<string, number>;
    /** Amount added per ability value name, the same at every skill level: the player's buffs, e.g. { stun_duration: 0.3 } */
    adds?: Record<string, number>;
    /** Highest size a buffed value may reach at any level (radius 1200, chance 60), per ability value name */
    maxes?: Record<string, number>;
    /** Lowest a lowered value may reach, as a multiple of its number at the current level, per ability value name */
    floors?: Record<string, number>;
}

/** How far one stat may be buffed and how big a click on it is (see stat_limits.ts) */
interface StatLimits {
    /** Short name for the audit, e.g. "nuke (ultimate)" */
    type: string;
    /** Share of the common % click this stat moves (1 = full click, 0.5 = half) */
    step: number;
    /** Smallest amount one common click moves the stat at minute 0, in the stat's own unit (0 = no minimum) */
    minimum: number;
    /** Late-game ceiling as a multiple of the level-1 number (bigger-is-better stats) */
    maxMultiple?: number;
    /** Late-game ceiling as an absolute number (radius 1200, chance 60), compared by size (a -30 counts as 30) */
    maxValue?: number;
    /** Late-game floor as a multiple of the number at the current level (lower-is-better stats) */
    lowest?: number;
    /** Late-game ceiling as an amount added to the level-1 number, in the stat's unit (health decay: +8 points) */
    maxAdd?: number;
    /**
     * Fixed click per rarity in the stat's unit, common to legendary (health decay: 0.1 / 0.2 / 0.3 / 0.5). Replaces
     * step, minimum and the rarity multiplier; does not grow over the game.
     */
    rarityClicks?: number[];
    /** Highest row rarity this stat may appear on (mana cost: rare) */
    maxRarity?: Rarity;
    /** Lowest row rarity this stat may appear on (proc chance: rare) */
    minRarity?: Rarity;
}

type UpgradeKind = "value" | "cooldown" | "casttime" | "manacost" | "castrange";

/** One thing a player can spend points on. Stacks: the same option can be taken several times. */
interface UpgradeOption {
    /** Unique per hero, e.g. "invoker_sun_strike:value:damage" */
    id: string;
    ability: string;
    kind: UpgradeKind;
    /** AbilityValues key, only for kind "value" */
    valueName?: string;
    /** Cast range only: the AbilityValues key that really decides how far the spell reaches (e.g. a hook's distance) */
    rangeValue?: string;
    /** Human readable name, e.g. "damage" or "cooldown" */
    label: string;
    /** Which way the number moves: "up" = bigger, "down" = smaller */
    direction: "up" | "down";
    /** Stat type, click size and how far it may go */
    limits: StatLimits;
    /** Base (level-1) number the option starts from, for display */
    base: number;
    /** A count (targets, charges...): whole numbers, at least +1 per click */
    count?: boolean;
    /** Lowest row rarity this stat may appear on (counts: rare, cast point: epic); any rarity if missing */
    minRarity?: Rarity;
    /** Only works with this item (a "(Scepter)" / "(Shard)" row) */
    item?: "scepter" | "shard";
}

/** One buffed stat in the "everyone's buffs" view (G1), as it is now. */
interface BoughtBuff {
    /** Option id, e.g. "lina_dragon_slave:value:dragon_slave_damage" (the UI localizes the label from it) */
    id: string;
    ability: string;
    /** Server label, used when Dota has no tooltip text for the value */
    label: string;
    /** The stat now, at the hero's current skill level with its buffs (text, ready to show) */
    now: string;
    /** At its final (late-game) limit in the direction it was moved (A3) */
    max: boolean;
    innate?: boolean;
}

/** What the buffs view shows for one player's hero */
interface HeroBuffSummary {
    hero: string;
    /** Bought buffs in ability order; an object keyed 1, 2... in Panorama */
    buffs: BoughtBuff[];
}

/** Boosts of one hero, keyed by ability name */
type HeroBoosts = Record<string, AbilityBoost>;

type Rarity = "common" | "rare" | "epic" | "legendary";

/** One row of the "Modify" list in the UI: a random boostable with its value */
interface ModifyRow {
    id: string;
    /** Ability name, e.g. "lina_light_strike_array" */
    ability: string;
    /** e.g. "cooldown" or "stun duration" */
    label: string;
    kind: UpgradeKind;
    /** How big one click on this row is: common < rare < epic < legendary */
    rarity: Rarity;
    /** Signed distance moved so far: above 0 = number pushed up, below 0 = pushed down */
    power: number;
    /** Whether the increase (▲) / decrease (▼) button is still allowed */
    canUp: boolean;
    canDown: boolean;
    /** The stat's number now, and what the increase / decrease button would make it (text, ready to show) */
    value: string;
    upValue: string;
    downValue: string;
    /** The same three numbers before rounding, for the detail line under the list */
    exactValue: number;
    upExact: number;
    downExact: number;
    /** The skill is the hero's innate: the row shows Dota's innate icon */
    innate?: boolean;
}

/** The random boostables currently offered to a player (3 to 5 rows) */
interface ModifyMenu {
    rows: ModifyRow[];
}

/** Points state of one player, for the UI */
interface PlayerPoints {
    /** Points available to spend */
    points: number;
    /** Points earned in total */
    earned: number;
    /** Upgrades bought so far */
    upgrades: number;
    /** Points the next upgrade costs */
    cost: number;
    /** The last few honey gains, newest first (not the passive gain over time); an object keyed 1, 2... in Panorama */
    recent?: HoneyEvent[];
}

/** One honey gain: "+10 creep", "+125 hero kill" */
interface HoneyEvent {
    amount: number;
    reason: string;
    /** Game clock (seconds) when it came in */
    time: number;
}

interface CustomNetTableDeclarations {
    /** Keyed by hero entity index (as string) */
    boost_upgrades: Record<string, HeroBoosts>;
    /** Keyed by player id (as string) */
    boost_points: Record<string, PlayerPoints>;
    /** Keyed by player id (as string); only human players get one */
    boost_options: Record<string, ModifyMenu>;
    /** Keyed by player id (as string): every player's bought buffs, visible to everyone (G1) */
    boost_summary: Record<string, HeroBuffSummary>;
}
