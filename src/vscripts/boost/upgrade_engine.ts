// Decides what a hero can be modified with (scan), picks random options (roll) and turns clicks into
// boosts (apply). Every option has a signed "power": a click moves the stat's number up, an Alt+click
// moves it down. How far one click moves it depends on the row's rarity (common 1, legendary 3).
// Power is the total change as a fraction of the level-1 number: 0.05 = +5%, -0.1 = -10%. How big a click is for
// each kind of stat and how far power may go are in stat_limits.ts; rarity multipliers in RaritySettings.
import { RaritySettings, rarityOrder } from "../game_settings";
import { resetBoosts, setBoostAdd, setBoostField, setBoostValue } from "./boost_store";
import { statGroup } from "./stat_types";
import { floorOf, powerRange, statProfile, tooltipFacts } from "./stat_limits";
import { tooltips } from "./tooltip_data";
import { config } from "./config";
import { blockedBySettings, castPointSkills, floorRule, isCountValue, isRemovedStat, isTickCount, limitFor, skillRules, ValueLimit } from "./skill_rules";

/**
 * The size of one common click right now, as a fraction of the original number: grows in a straight line from the
 * host's start size (minute 0) to the late size (at buffSizeLateMinute), then stays there. Never below buffSizeMin, which
 * makes early buffs bigger without touching mid and late game (with 2 -> 10 over 30 min, a 4% floor ends at minute 7.5).
 */
export function clickSize(): number {
    const minutes = math.max(GameRules.GetDOTATime(false, false) / 60, 0);
    const progress = math.min(minutes / math.max(config.buffSizeLateMinute, 1), 1);
    const size = config.buffSizeStart + (config.buffSizeLate - config.buffSizeStart) * progress;
    return math.max(size, config.buffSizeMin) / 100;
}

/** A multiplier never drops below this, so no number ever reaches zero. */
const MIN_MULTIPLIER = 0.05;

/** Ability value keys that must never be modified (matched as lowercase substrings). */
const valueBlacklist = ["scepter", "shard", "talent", "special_bonus", "tooltip", "requires", "hidden", "interval", "level"];

/** Ability value keys where a smaller number is the better one. */
// Tick rates and intervals too: a shorter time between ticks means the effect lands more often
const lowerIsBetter = ["cooldown", "delay", "cost", "self_stun", "tick_rate", "tickrate", "tick_interval", "respawn"];

/** Cooldown, cast point, mana cost and cast range have their own hooks. Where the ability KV stores them, by kind. */
const genericStats: [UpgradeKind, string, "up" | "down"][] = [
    ["cooldown", "AbilityCooldown", "down"],
    ["casttime", "AbilityCastPoint", "down"],
    ["manacost", "AbilityManaCost", "down"],
    ["castrange", "AbilityCastRange", "up"],
];

const genericLabels: Record<string, string> = {
    cooldown: "cooldown",
    casttime: "cast point",
    manacost: "mana cost",
    castrange: "cast range",
};

/** Abilities that sit on a hero but are not real spells. */
const abilityBlacklist = ["ability_capture", "abyssal_underlord_portal_warp", "twin_gate_portal_warp", "ability_lamp_use"];

// heroKey -> optionId -> power (can be negative)
const powers: Record<string, Record<string, number>> = {};

// heroKey -> ability name -> how many times the skill was modified (any direction, any stat)
const timesModified: Record<string, Record<string, number>> = {};

/** How many times a hero's skill has been modified so far. */
export function getTimesModified(hero: CDOTA_BaseNPC, abilityName: string): number {
    return timesModified[heroKey(hero)]?.[abilityName] ?? 0;
}

/** Rolls a rarity for one row, using the chances from the setup menu (relative weights). */
export function rollRarity(allowed?: (rarity: Rarity) => boolean): Rarity {
    const weights: Record<Rarity, number> = {
        common: config.rarityCommon,
        rare: config.rarityRare,
        epic: config.rarityEpic,
        legendary: config.rarityLegendary,
    };
    if (allowed !== undefined) for (const rarity of rarityOrder) if (!allowed(rarity)) weights[rarity] = 0;
    const total = rarityOrder.reduce((sum, rarity) => sum + weights[rarity], 0);
    if (total <= 0) return "common";

    let roll = RandomFloat(0, total);
    for (const rarity of rarityOrder) {
        roll -= weights[rarity];
        if (roll <= 0 && weights[rarity] > 0) return rarity;
    }
    return "common";
}

/** Common 0 to legendary 3: the rarity whose multiplier is closest to a click's `multiplier` (for fixed clicks per rarity). */
function rarityIndex(multiplier: number): number {
    let best = 0;
    for (let i = 1; i < rarityOrder.length; i++) {
        const distance = math.abs(RaritySettings[rarityOrder[i]].multiplier - multiplier);
        if (distance < math.abs(RaritySettings[rarityOrder[best]].multiplier - multiplier)) best = i;
    }
    return best;
}

/** How much bigger one click is for this rarity. */
export function rarityMultiplier(rarity: Rarity): number {
    return RaritySettings[rarity].multiplier;
}

function heroKey(hero: CDOTA_BaseNPC): string {
    return tostring(hero.GetEntityIndex());
}

/**
 * KV numbers come as number, "10 20 30" (one per ability level) or { value = "10 20 30", special_bonus_... }.
 * Returns the number for the given ability level (1 = first).
 */
function parseAtLevel(raw: unknown, abilityLevel: number): number | undefined {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
        const parts = raw.split(" ").filter(part => part !== "");
        if (parts.length === 0) return undefined;
        return tonumber(parts[math.min(math.max(abilityLevel, 1), parts.length) - 1]);
    }
    if (typeof raw === "object" && raw !== undefined) return parseAtLevel((raw as any).value, abilityLevel);
    return undefined;
}

/**
 * The raw KV entry of a generic stat (cooldown, cast point, mana cost, cast range). Newer skills keep it in
 * AbilityValues and leave an empty "0" at the top level, so a top-level 0 must not hide the real number.
 */
function statRaw(keyValues: any, kvKey: string): unknown {
    const top = keyValues[kvKey];
    if (top !== undefined && (parseAtLevel(top, 1) ?? 0) > 0) return top;
    return keyValues.AbilityValues?.[kvKey] ?? top;
}

/** Innate abilities (one per hero, always known). Dota has no API for this, so read the KV flag or the name. */
function isInnate(ability: CDOTABaseAbility): boolean {
    const keyValues = ability.GetAbilityKeyValues() as any;
    return tonumber(keyValues.Innate) === 1 || ability.GetAbilityName().includes("_innate_");
}

/**
 * Invoker's spells that have been invoked at least once (entity index -> true). They hide again when another spell
 * takes their slot, but stay buffable, so they can still roll and a row on the list is not replaced (user 2026-09-30).
 */
const invokedOnce: Record<number, boolean> = {};

/** Why an ability can never be modified, or undefined if it can. */
export function skipReason(ability: CDOTABaseAbility): string | undefined {
    const name = ability.GetAbilityName();
    if (ability.IsItem()) return "item";
    if (ability.IsAttributeBonus() || name.startsWith("special_bonus_")) return "talent";
    if (abilityBlacklist.includes(name)) return "blacklisted";
    if (name.startsWith("invoker_") && !ability.IsHidden()) invokedOnce[ability.entindex()] = true;
    // Innate abilities are often marked hidden but are real skills; other hidden ones (Scepter/Shard skills
    // before they are owned, empty slots) are not usable
    if (ability.IsHidden() && !isInnate(ability) && !invokedOnce[ability.entindex()]) return "hidden";
    return undefined;
}

export function isUpgradable(ability: CDOTABaseAbility): boolean {
    return skipReason(ability) === undefined;
}

/**
 * The item a value only exists with: its KV entry is 0 (or missing) without the item and the item grants it
 * (special_bonus_scepter / special_bonus_shard), or it is flagged RequiresScepter / RequiresShard.
 * Names that merely contain "shard" or "scepter" without such an entry are leftovers and stay blocked.
 */
/** Whether a behavior bit set (numbers above 32 bits, and Dota's Lua has no bit operators) contains `flag`. */
function hasBehavior(behavior: number, flag: number): boolean {
    return math.floor(behavior / flag) % 2 === 1;
}

/**
 * The Aghanim's Scepter option an Invoker took: 1 Quas (Ice Floe), 2 Wex (Tornado twisters), 3 Exort (Cataclysm), 0 without
 * a Scepter. Lua cannot read the choice itself (no modifier, facet or order shows it), but it changes the spell:
 * option 3 makes Sun Strike unit-targetable (behavior +8), option 1 makes Ice Wall vector targeted (Ice Floe); neither
 * means option 2. All three confirmed in game 2026-09-30.
 */
export function invokerScepterOption(unit: CDOTA_BaseNPC): number {
    if (!unit.IsHero() || !(unit as CDOTA_BaseNPC_Hero).HasScepter()) return 0;
    const behavior = (name: string) => tonumber(tostring(unit.FindAbilityByName(name)?.GetBehavior() ?? 0)) ?? 0;
    if (hasBehavior(behavior("invoker_sun_strike"), AbilityBehavior.UNIT_TARGET)) return 3;
    if (hasBehavior(behavior("invoker_ice_wall"), AbilityBehavior.VECTOR_TARGETING)) return 1;
    return 2;
}

function requiredItem(raw: unknown): "scepter" | "shard" | undefined {
    if (typeof raw !== "object" || raw === undefined) return undefined;
    const entry = raw as any;
    if (entry.RequiresScepter !== undefined) return "scepter";
    if (entry.RequiresShard !== undefined) return "shard";
    if ((parseAtLevel(raw, 1) ?? 0) !== 0) return undefined;
    if (entry.special_bonus_scepter !== undefined) return "scepter";
    if (entry.special_bonus_shard !== undefined) return "shard";
    return undefined;
}

/** The number an item grants from its KV entry ("20", "+20" or "=20"), for heroes that do not own the item. */
function itemBonus(raw: unknown, item: "scepter" | "shard"): number | undefined {
    const bonus = (raw as any)[`special_bonus_${item}`];
    if (bonus === undefined) return undefined;
    const [text] = string.gsub(tostring(bonus), "^[=+]+", "");
    return parseAtLevel(text, 1);
}

function ownsItem(hero: CDOTA_BaseNPC, item: "scepter" | "shard"): boolean {
    return item === "scepter" ? hero.HasScepter() : hero.HasModifier("modifier_item_aghanims_shard");
}

/**
 * The number the game uses for a value right now without our buff: includes Scepter, Shard and talent bonuses.
 * Dota counts levels from 0 here. Undefined for a skill not learned yet.
 */
function liveValue(ability: CDOTABaseAbility, valueName: string): number | undefined {
    if (ability.GetLevel() < 1) return undefined;
    return ability.GetLevelSpecialValueNoOverride(valueName, ability.GetLevel() - 1);
}

/**
 * Rounds a modified stat to at most one decimal so players see clean numbers (153.5, not 153.4721).
 * Used for the real value (modifier_boost) and for the numbers in the BUFF panel, so both always agree.
 */
export function roundStat(value: number): number {
    return math.floor(value * 10 + 0.5) / 10;
}

/** AbilityValues keys that often hold how far a spell reaches when the ability has no usable cast range of its own. */
const rangeAliases = ["hook_distance", "cast_range", "range", "distance", "projectile_distance", "travel_distance"];

/**
 * The AbilityValues key behind an ability's cast range, if the range is written as "%key" or is missing and a
 * distance-like value exists (Pudge's hook). Undefined when the normal AbilityCastRange number is usable.
 */
function findRangeValue(keyValues: any): string | undefined {
    const values = keyValues.AbilityValues ?? {};
    const raw = keyValues.AbilityCastRange;
    if (typeof raw === "string" && raw.startsWith("%") && values[raw.substring(1)] !== undefined) {
        return raw.substring(1);
    }
    // The top-level field is the one the tooltip and the aiming circle read; if it is unusable (0 or missing),
    // but AbilityValues has a real "AbilityCastRange" number of its own (Pudge's hook), buff that one instead.
    const plain = parseAtLevel(raw, 1);
    if (plain !== undefined && plain > 0) return undefined;
    if (values.AbilityCastRange !== undefined && (parseAtLevel(values.AbilityCastRange, 1) ?? 0) > 0) return "AbilityCastRange";
    return rangeAliases.find(alias => values[alias] !== undefined && (parseAtLevel(values[alias], 1) ?? 0) > 0);
}

function humanize(valueName: string): string {
    return valueName.split("_").join(" ");
}

/** A value's name for people: Dota's own tooltip label when known ("health decay"), else the value name spelled out. */
function valueLabel(abilityName: string, valueName: string): string {
    const { tooltip } = tooltipFacts(tooltips[`${abilityName}|${valueName}`], valueName);
    return tooltip !== "" ? tooltip : humanize(valueName);
}

// --- Vision follows reach ---
const visionLinkCache: Record<string, Record<string, string>> = {};
const reachWords = ["radius", "range", "distance", "width", "aoe", "area_of_effect"];
/** Reach values that are an area, preferred as vision's partner when no number matches (Invoker's area_of_effect) */
const areaWords = ["radius", "aoe", "area_of_effect"];
// Only vision distances follow reach; how long vision lasts or a vision cone's angle are stats of their own
const isVisionName = (lower: string) =>
    (lower.includes("vision") || lower.includes("sight")) && !["duration", "time", "cone", "pct"].some(word => lower.includes(word));

/**
 * The vision values of a skill and the stat each one follows: the radius/range value with the same starting number,
 * otherwise the skill's cast range ("castrange"), otherwise its area (radius / area_of_effect; user 2026-09-30:
 * Invoker's spells have global or no cast range and vision numbers of their own, so their vision was its own row),
 * otherwise any reach. Only a skill with no reach at all keeps vision as a stat of its own.
 * Linked vision is never offered by itself; it moves with its partner by the same share (changePower).
 */
export function visionLinks(ability: CDOTABaseAbility): Record<string, string> {
    const name = ability.GetAbilityName();
    const cached = visionLinkCache[name];
    if (cached !== undefined) return cached;

    const keyValues = ability.GetAbilityKeyValues() as any;
    const values = keyValues.AbilityValues ?? {};
    const reaches: [string, number][] = [];
    for (const valueName in values) {
        const lower = valueName.toLowerCase();
        if (isVisionName(lower) || !reachWords.some(word => lower.includes(word))) continue;
        const base = parseAtLevel(values[valueName], 1);
        if (base !== undefined && base > 0) reaches.push([valueName, base]);
    }
    const hasCastRange = (parseAtLevel(statRaw(keyValues, "AbilityCastRange"), 1) ?? 0) > 0;

    const links: Record<string, string> = {};
    for (const valueName in values) {
        if (!isVisionName(valueName.toLowerCase())) continue;
        const base = parseAtLevel(values[valueName], 1);
        const partner = reaches.find(([, reachBase]) => reachBase === base);
        const area = reaches.find(([reach]) => areaWords.some(word => reach.toLowerCase().includes(word)));
        if (partner !== undefined) links[valueName] = partner[0];
        else if (hasCastRange) links[valueName] = "castrange";
        else if (area !== undefined) links[valueName] = area[0];
        else if (reaches.length > 0) links[valueName] = reaches[0][0];
    }
    visionLinkCache[name] = links;
    return links;
}

/**
 * Every modification currently possible for one ability. With `assumeItems`, Scepter and Shard values are listed
 * even if the hero does not own the items (for the audit report).
 */
export function getAbilityOptions(ability: CDOTABaseAbility, assumeItems = false): UpgradeOption[] {
    const name = ability.GetAbilityName();
    const keyValues = ability.GetAbilityKeyValues() as any;
    const options: UpgradeOption[] = [];
    if (skillRules[name]?.skip) return options;

    const castRangeRule = skillRules[name]?.castRange;
    const rangeValue = ability.IsPassive() || castRangeRule === undefined ? undefined : castRangeRule.pairedValue ?? findRangeValue(keyValues);

    // What the stat profiles need to know about the skill (stat_limits.ts)
    const ultimate = ability.GetAbilityType() === AbilityTypes.ULTIMATE;
    const cooldown = parseAtLevel(statRaw(keyValues, "AbilityCooldown"), 1) ?? 0;
    const limitsOf = (statKey: string, kind: UpgradeKind, base: number, direction: "up" | "down", rule: ValueLimit = { hidden: false }) => {
        const { tooltip, percent, percentShown } = tooltipFacts(kind === "value" ? tooltips[`${name}|${statKey}`] : undefined, statKey);
        const facts = { abilityName: name, statKey, kind, base, direction, ultimate, cooldown, tooltip, percent, percentShown };
        const limits = statProfile(facts, rule.cap, rule.ceiling);
        if (rule.maxAdd !== undefined) {
            limits.maxAdd = math.min(limits.maxAdd ?? rule.maxAdd, rule.maxAdd);
            // A skill's own count limit replaces the count ceiling (skill_rules countMaxAdd)
            if (isCountValue(statKey)) limits.maxMultiple = undefined;
        }
        // A skill's own floor (skill_rules floors): lower-is-better stats only, the only ones worth lowering
        const floor = floorRule(name, statKey);
        if (floor !== undefined && direction === "down") limits.lowest = math.max(limits.lowest ?? 0.4, floor);
        return limits;
    };
    // A stat with no room to grow even late (a 100% chance, a radius already at 1200) is never offered
    const hasRoom = (option: UpgradeOption) => option.direction === "down" || powerRange(option, 1, 1).high > 0.0001;

    // Numbers inside AbilityValues (damage, radius, duration, ...)
    for (const valueName in keyValues.AbilityValues ?? {}) {
        const lower = valueName.toLowerCase();
        const raw = keyValues.AbilityValues[valueName];
        // Values a Scepter or Shard grants: only once the hero owns the item. Other blacklisted words still block.
        // Item values the KV does not flag (Invoker's Cataclysm), some only with the Scepter option the player took
        const ruleItem = skillRules[name]?.itemValues?.find(entry => lower.includes(entry.word));
        if (ruleItem?.option !== undefined && !assumeItems && invokerScepterOption(ability.GetCaster()) !== ruleItem.option) continue;
        const item = requiredItem(raw) ?? ruleItem?.item;
        if (item !== undefined && !assumeItems && !ownsItem(ability.GetCaster(), item)) continue;
        // Item values may say "scepter"/"shard" in their name; every other blacklisted word (tooltip, ...) still blocks
        const itemWord = (word: string) => item !== undefined && (word === "scepter" || word === "shard");
        if (valueBlacklist.some(word => lower.includes(word) && !itemWord(word))) continue;
        // Charge refill times are cooldowns in all but name
        const isCooldown = lower.includes("cooldown") || lower.includes("restoretime") || lower.includes("restore_time");
        if (config.allowCooldown !== 1 && isCooldown) continue;
        // Handled below through the dedicated cooldown / cast point / mana / range hooks
        if (genericStats.some(([, kvKey]) => kvKey === valueName)) continue;
        // Changed through the cast range option instead, so the same number is not offered twice
        if (valueName === rangeValue) continue;
        // Vision that follows a radius or the cast range moves with it instead
        if (visionLinks(ability)[valueName] !== undefined) continue;

        // Item values are 0 in the KV; take the number the game uses with the item
        const base = item !== undefined ? liveValue(ability, valueName) ?? itemBonus(raw, item) : parseAtLevel(raw, 1);
        if (base === undefined || base === 0) continue;

        const limit = limitFor(name, valueName);
        if (limit.hidden) continue;

        // "rot_tick" is a tick rate (smaller = faster), but "damage_per_tick" is an amount per tick (bigger is better)
        const tickRate = lower.endsWith("_tick") && !lower.includes("per_tick");
        const lowerRule = skillRules[name]?.lowerValues?.some(word => lower.includes(word)) ?? false;
        const direction = lowerIsBetter.some(word => lower.includes(word)) || tickRate || lowerRule ? "down" : "up";
        const option: UpgradeOption = {
            id: `${name}:value:${valueName}`,
            limits: limitsOf(valueName, "value", base, direction, limit),
            ability: name,
            kind: "value",
            valueName,
            label: item !== undefined ? `${valueLabel(name, valueName)} (${item === "scepter" ? "Scepter" : "Shard"})` : valueLabel(name, valueName),
            item,
            direction,
            base,
            // Counts by name, or set to Count on the review page (Axe's trigger_attacks): whole steps, epic or better;
            // a number of ticks (Pudge Dismember) only on legendary rows
            count: isCountValue(valueName) || statGroup(name, valueName) === "Count" || undefined,
            minRarity: isTickCount(valueName)
                ? "legendary"
                : isCountValue(valueName) || statGroup(name, valueName) === "Count"
                  ? "epic"
                  : undefined,
        };
        if (hasRoom(option)) options.push(option);
    }

    // Cooldown, cast point, mana cost and cast range only make sense for spells you actively cast
    if (!ability.IsPassive()) {
        for (const [kind, kvKey, direction] of genericStats) {
            if (kind === "cooldown" && config.allowCooldown !== 1) continue;
            // Cast range rows only for the skills listed in skill_rules.ts
            if (kind === "castrange" && castRangeRule === undefined) continue;
            // Cast point rows only for the skills listed in skill_rules.ts
            if (kind === "casttime" && !castPointSkills.includes(name)) continue;
            // Some abilities keep these numbers inside AbilityValues instead of at the top level
            let base = parseAtLevel(statRaw(keyValues, kvKey), 1);
            if (kind === "castrange" && rangeValue !== undefined) base = parseAtLevel(keyValues.AbilityValues[rangeValue], 1);
            if (base === undefined || base <= 0) continue;
            options.push({
                id: `${name}:${kind}`,
                ability: name,
                kind,
                label: genericLabels[kind],
                direction,
                base,
                rangeValue: kind === "castrange" ? rangeValue : undefined,
                limits: limitsOf(kind, kind, base, direction, { hidden: false, cap: kind === "castrange" ? castRangeRule?.cap : undefined }),
                // Cast point: small numbers that are hard to notice, so only on the bigger epic and legendary rows
                minRarity: kind === "casttime" ? "epic" : undefined,
            });
        }
    }

    // The full audit (assumeItems) lists removed stats too, so the review page always shows every stat
    if (assumeItems) return options;
    return options.filter(option => {
        const key = option.valueName ?? option.kind;
        return !isRemovedStat(name, key) && !blockedBySettings(name, key);
    });
}

export function getPower(hero: CDOTA_BaseNPC, option: UpgradeOption): number {
    return powers[heroKey(hero)]?.[option.id] ?? 0;
}

/** +1 if a bigger number is the good direction for this stat, -1 if a smaller one is. */
export function goodDelta(option: UpgradeOption): 1 | -1 {
    return option.direction === "up" ? 1 : -1;
}

/**
 * The size of the stat at the skill's current level divided by its level-1 size (skill values only; cooldown, cast
 * point, mana cost and cast range are multipliers or bonuses, so 1). Absolute ceilings and floors use it.
 */
function levelRatio(hero: CDOTA_BaseNPC, option: UpgradeOption): number {
    if (option.kind !== "value" || option.base === 0) return 1;
    const ability = hero.FindAbilityByName(option.ability);
    if (ability === undefined || ability.GetLevel() < 1) return 1;
    return math.abs(baseNow(ability, option)) / math.abs(option.base);
}

/** The lowest and highest power the option may have right now for this hero (see stat_limits.ts). */
function powerLimits(hero: CDOTA_BaseNPC, option: UpgradeOption): { low: number; high: number } {
    return powerRange(option, levelRatio(hero, option));
}

/**
 * Share of the room still open in this direction that one click may close. Without this, the guaranteed minimum
 * click size (below) can swallow the WHOLE room in one common click when the room itself is still small (early
 * game, or a tightly capped stat like cast range): a legendary click would clamp to the very same ceiling right
 * after it, making the two rarities look identical. Kept high enough that a common click is rarely affected.
 */
const CLICK_ROOM_SHARE = 0.8;

/**
 * The unit a skill value's click moves in, so numbers stay clean (user 2026-09-29): whole numbers for values of 10
 * or more (damage 25 -> 31, not 31.3), tenths below that (stun 0.6 -> 0.7; user 2026-09-30: also under 1, no more
 * 0.35 -> 0.4375). Only tiny values under 0.2 (a 0.1 s tick) keep exact steps, where a tenth would double them, and so
 * do cooldown and mana cost (a multiplier, so not whole at other levels anyway) and cast point (hundredths).
 */
function clickGrain(option: UpgradeOption): number | undefined {
    if (option.kind !== "value" || option.limits.rarityClicks !== undefined) return undefined;
    const size = math.abs(option.base);
    if (size >= 10) return 1;
    if (size >= 0.2) return 0.1;
    return undefined;
}

/** How far one click of `size` (see clickSize), times `multiplier` from the rarity, moves power, given how much room is left. */
function clickPower(option: UpgradeOption, multiplier: number, size: number, room: number): number {
    // Counts move by exactly one per click, whatever the size or rarity: 3 bounces -> 4, never 3.06 or 5
    if (option.count) return 1 / math.abs(option.base);
    // A fixed amount per rarity (health decay: 0.1 / 0.2 / 0.3 / 0.5 points), the same all game
    const fixed = option.limits.rarityClicks;
    if (fixed !== undefined) return (fixed[rarityIndex(multiplier)] ?? fixed[0]) / math.abs(option.base);
    const change = freeClickPower(option, multiplier, size, room);
    const grain = clickGrain(option);
    if (grain === undefined) return change;
    // Rounded to the grain (at least one), and the room share also rounded down to it; when even that is less than
    // one grain, the rest of the room (rounded down) so the stat can still reach its ceiling in whole steps
    const base = math.abs(option.base);
    const down = (amount: number) => math.floor(amount / grain + 0.0001) * grain;
    const amount = math.max(math.floor((change * base) / grain + 0.5) * grain, grain);
    const shared = down(math.max(room, 0) * base * CLICK_ROOM_SHARE);
    const limit = shared >= grain ? shared : down(math.max(room, 0) * base);
    return math.min(amount, limit) / base;
}

/** clickPower before rounding: step times size and rarity, at least the stat's minimum, at most part of the room. */
function freeClickPower(option: UpgradeOption, multiplier: number, size: number, room: number): number {
    let change = size * option.limits.step * multiplier;
    // Never less than the stat's minimum amount (0.1 s of stun, 5 damage...), so every click shows. The minimum grows
    // over the game like the % step does, and rarity multiplies it too.
    const minimum = option.limits.minimum;
    if (minimum > 0 && option.base !== 0) {
        const growth = size / math.max(config.buffSizeMin / 100, 0.001);
        change = math.max(change, (minimum * growth * multiplier) / math.abs(option.base));
    }
    return math.min(change, math.max(room, 0) * CLICK_ROOM_SHARE);
}

/**
 * Where power ends up after one click in `direction`, never past the limit on that side. A limit that moved behind
 * the power (a level-up raised the number towards its ceiling) does not pull it back: the stat just cannot go further.
 */
function movedPower(
    option: UpgradeOption,
    power: number,
    direction: number,
    multiplier: number,
    size: number,
    limits: { low: number; high: number },
): number {
    const room = direction > 0 ? math.max(limits.high, power) - power : power - math.min(limits.low, power);
    const change = clickPower(option, multiplier, size, room);
    if (direction > 0) return math.min(power + change, math.max(limits.high, power));
    return math.max(power - change, math.min(limits.low, power));
}

/** Can power still move in `direction` (+1 or -1), or is it already at that limit? */
export function canChange(hero: CDOTA_BaseNPC, option: UpgradeOption, direction: number): boolean {
    const power = getPower(hero, option);
    const { low, high } = powerLimits(hero, option);
    // A count needs room for one whole step: it never moves by part of one. The same for a value that moves in whole
    // numbers or tenths (clickGrain).
    const grain = option.count ? 1 : clickGrain(option);
    const room = grain !== undefined ? grain / math.abs(option.base) - 0.0001 : 0.0001;
    return direction > 0 ? power + room <= high : power - room >= low;
}

/** Whether both buttons of the stat's row can still be used (neither at its ceiling nor at its floor). */
export function canMoveBothWays(hero: CDOTA_BaseNPC, option: UpgradeOption): boolean {
    return canChange(hero, option, 1) && canChange(hero, option, -1);
}

/** Every option possible for a hero, grouped by ability (only trained abilities). Without includeMaxed, options already at their best level are left out. */
export function getHeroOptions(hero: CDOTA_BaseNPC, includeMaxed = false): UpgradeOption[][] {
    const groups: UpgradeOption[][] = [];
    for (let i = 0; i < hero.GetAbilityCount(); i++) {
        const ability = hero.GetAbilityByIndex(i);
        if (ability === undefined || !isUpgradable(ability)) continue;

        // Rows have both an increase and a decrease button (user 2026-09-30): a stat is offered only while it can still
        // move both ways, so one at its ceiling or floor stays out until the ceiling grows
        const options = getAbilityOptions(ability).filter(o => includeMaxed || canMoveBothWays(hero, o));
        if (options.length > 0) groups.push(options);
    }
    return groups;
}

/** Finds an option of the hero by its id (also ones at their limit; they can still move the other way). */
export function findOption(hero: CDOTA_BaseNPC, optionId: string): UpgradeOption | undefined {
    for (const group of getHeroOptions(hero, true)) {
        for (const option of group) {
            if (option.id === optionId) return option;
        }
    }
}

/**
 * Picks up to `count` random options, at most one per ability. Picks an ability first and then one of its options,
 * so abilities with many values do not crowd out the rest. Ids in `exclude` are never picked.
 */
export function rollOptions(
    hero: CDOTA_BaseNPC,
    count: number,
    exclude: string[] = [],
    rarity?: Rarity,
    accept?: (option: UpgradeOption) => boolean,
): UpgradeOption[] {
    const usedAbilities = exclude.map(id => id.split(":")[0]);
    // Some stats only appear on rarer rows (counts and cast point: epic or better)
    const rank = (r: Rarity) => rarityOrder.indexOf(r);
    const maxRarity = (o: UpgradeOption) => o.limits.maxRarity;
    const minRarity = (o: UpgradeOption) => o.minRarity ?? o.limits.minRarity;
    const allowed = (o: UpgradeOption) =>
        !exclude.includes(o.id) &&
        (rarity === undefined || minRarity(o) === undefined || rank(rarity) >= rank(minRarity(o)!)) &&
        (rarity === undefined || maxRarity(o) === undefined || rank(rarity) <= rank(maxRarity(o)!)) &&
        (accept === undefined || accept(o));
    const all = getHeroOptions(hero).map(group => group.filter(allowed));
    const picked: UpgradeOption[] = [];

    // First pass: at most one row per ability, and none for abilities that already have a row
    const groups = all.map(group => group.filter(o => !usedAbilities.includes(o.ability))).filter(group => group.length > 0);
    while (picked.length < count && groups.length > 0) {
        const groupIndex = RandomInt(0, groups.length - 1);
        const group = groups[groupIndex];
        picked.push(group[RandomInt(0, group.length - 1)]);
        groups.splice(groupIndex, 1);
    }

    // Second pass, only when the hero has fewer abilities than rows: fill up with other stats of the same
    // abilities, so the list still has `count` rows (never the same stat twice)
    const rest: UpgradeOption[] = [];
    for (const group of all) for (const option of group) if (!picked.includes(option)) rest.push(option);
    while (picked.length < count && rest.length > 0) {
        const index = RandomInt(0, rest.length - 1);
        picked.push(rest[index]);
        rest.splice(index, 1);
    }
    return picked;
}

// --- Numbers ---

/**
 * What the stat is for the ability's current level with no modification: what the UI starts from.
 * Ability values use the game's live number, so Scepter, Shard and talent bonuses are included.
 */
function baseNow(ability: CDOTABaseAbility, option: UpgradeOption): number {
    const keyValues = ability.GetAbilityKeyValues() as any;
    let raw: unknown;
    if (option.rangeValue !== undefined) {
        raw = liveValue(ability, option.rangeValue) ?? keyValues.AbilityValues?.[option.rangeValue];
    } else if (option.kind === "value") {
        raw = liveValue(ability, option.valueName!) ?? keyValues.AbilityValues?.[option.valueName!];
    } else {
        const kvKey = genericStats.find(([kind]) => kind === option.kind)![1];
        raw = statRaw(keyValues, kvKey);
    }
    return parseAtLevel(raw, ability.GetLevel()) ?? option.base;
}

/**
 * The stat's limits for the audit: its type, how far one common click moves it now, and where it stops now and
 * late (from minute 30), at level 1. E.g. "area: click +10, max now 437 / late 1200".
 */
export function describeLimits(option: UpgradeOption): string {
    const now = powerRange(option, 1);
    const late = powerRange(option, 1, 1);
    const room = option.direction === "up" ? now.high : -now.low;
    const click = clickPower(option, 1, clickSize(), room) * math.abs(option.base);
    const at = (power: number) => roundStat(math.abs(exactAt(option.base, option, power)));
    const clickText = option.count ? "+1" : `${option.direction === "up" ? "+" : "-"}${roundStat(click)}`;
    const edge = option.direction === "up" ? `max now ${at(now.high)} / late ${at(late.high)}` : `min now ${at(now.low)} / late ${at(late.low)}`;
    return `${option.limits.type}: click ${clickText}, ${edge}`;
}

/** The multiplier (or flat bonus for cast range) a power stands for. */
function effectOf(option: UpgradeOption, power: number): number {
    return option.kind === "castrange" ? math.floor(option.base * power + 0.5) : math.max(1 + power, MIN_MULTIPLIER);
}

/** The stat before rounding (cast range bonuses are whole numbers already). */
function exactAt(base: number, option: UpgradeOption, power: number): number {
    if (option.kind === "castrange") return base + effectOf(option, power);
    // Skill values: the same amount (a share of the level-1 number) is added at every level, kept between the floor
    // and the ceiling the same way modifier_boost does it
    if (option.kind === "value") {
        let value = base + option.base * power;
        const floorSize = math.abs(base) * floorOf(option);
        if (math.abs(value) < floorSize || value * base < 0) value = base < 0 ? -floorSize : floorSize;
        const max = option.direction === "up" ? option.limits.maxValue : undefined;
        if (max !== undefined) {
            const ceiling = math.max(max, math.abs(base));
            if (math.abs(value) > ceiling) value = value < 0 ? -ceiling : ceiling;
        }
        return option.count ? math.floor(value + 0.5) : value;
    }
    // Counts are whole numbers in the game too (modifier_boost rounds them the same way)
    return option.count ? math.floor(base * effectOf(option, power) + 0.5) : base * effectOf(option, power);
}

function statAt(base: number, option: UpgradeOption, power: number): number {
    const value = exactAt(base, option, power);
    // Cast points are fractions of a second (0.3): one decimal would hide every change
    return option.kind === "casttime" ? math.floor(value * 100 + 0.5) / 100 : roundStat(value);
}

/** A stat already rounded by statAt, as text (no trailing zeros). */
function format(value: number): string {
    return tostring(value);
}

/**
 * What the UI shows for one option: the stat now, and what a click or an Alt+click of this rarity would make it.
 * `size` is the click size of the player's next buff (see nextClickSize in points.ts).
 */
export function describeRow(hero: CDOTA_BaseNPC, option: UpgradeOption, rarity: Rarity = "common", size = clickSize()): ModifyRow {
    const power = getPower(hero, option);
    const ability = hero.FindAbilityByName(option.ability);
    const base = ability !== undefined ? baseNow(ability, option) : option.base;
    const rarityScale = rarityMultiplier(rarity);
    const limits = powerLimits(hero, option);
    const up = movedPower(option, power, 1, rarityScale, size, limits);
    const down = movedPower(option, power, -1, rarityScale, size, limits);
    return {
        id: option.id,
        ability: option.ability,
        label: option.label,
        kind: option.kind,
        rarity,
        power,
        canUp: canChange(hero, option, 1),
        canDown: canChange(hero, option, -1),
        value: format(statAt(base, option, power)),
        upValue: format(statAt(base, option, up)),
        downValue: format(statAt(base, option, down)),
        exactValue: exactAt(base, option, power),
        upExact: exactAt(base, option, up),
        downExact: exactAt(base, option, down),
        innate: (ability !== undefined && isInnate(ability)) || undefined,
    };
}

// --- Buffs view (G1) ---

/** Whether the stat is at its final (late-game, minute 30+) limit in `direction`: the MAX badge. */
function atFinalLimit(hero: CDOTA_BaseNPC, option: UpgradeOption, direction: number): boolean {
    const power = getPower(hero, option);
    const { low, high } = powerRange(option, levelRatio(hero, option), 1);
    const grain = option.count ? 1 : clickGrain(option);
    const room = grain !== undefined ? grain / math.abs(option.base) - 0.0001 : 0.0001;
    return direction > 0 ? power + room > high : power - room < low;
}

/**
 * A cheap fingerprint of everything the buffs view shows for a hero: each bought stat's power and its skill's level,
 * and the hero's Scepter/Shard. The game tick rebuilds the summary only when it changes.
 */
export function buffsSignature(hero: CDOTA_BaseNPC): string {
    const parts: string[] = [hero.HasScepter() ? "S" : "", hero.HasModifier("modifier_item_aghanims_shard") ? "H" : ""];
    for (const [id, power] of pairs(powers[heroKey(hero)] ?? {})) {
        const abilityName = id.split(":")[0];
        parts.push(`${id}=${power}@${hero.FindAbilityByName(abilityName)?.GetLevel() ?? 0}`);
    }
    return parts.join("|");
}

/** Every stat the hero's buffs moved, in ability order, as the buffs view shows it. */
export function describeBoughtBuffs(hero: CDOTA_BaseNPC): BoughtBuff[] {
    const bought = powers[heroKey(hero)] ?? {};
    const result: BoughtBuff[] = [];
    for (const group of getHeroOptions(hero, true)) {
        for (const option of group) {
            const power = bought[option.id] ?? 0;
            if (math.abs(power) < 0.00001) continue;
            const ability = hero.FindAbilityByName(option.ability);
            const base = ability !== undefined ? baseNow(ability, option) : option.base;
            result.push({
                id: option.id,
                ability: option.ability,
                label: option.label,
                now: format(statAt(base, option, power)),
                max: atFinalLimit(hero, option, power > 0 ? 1 : -1),
                innate: (ability !== undefined && isInnate(ability)) || undefined,
            });
        }
    }
    return result;
}

// --- Applying ---

/** Sets the option's power and writes the resulting boost. Shared by a normal click and `maxOut`. */
function setPower(hero: CDOTA_BaseNPC, option: UpgradeOption, power: number): void {
    const key = heroKey(hero);
    powers[key] ??= {};
    powers[key][option.id] = power;

    // Every click (or a jump straight to the cap) counts toward the host's limit of modifications per skill
    timesModified[key] ??= {};
    timesModified[key][option.ability] = (timesModified[key][option.ability] ?? 0) + 1;

    const effect = effectOf(option, power);
    if (option.kind === "value") {
        const amount = option.base * power;
        // The ceiling and floor go along, so leveling the skill up can never carry the value past them
        const max = option.direction === "up" ? option.limits.maxValue : undefined;
        setBoostAdd(hero, option.ability, option.valueName!, option.count ? math.floor(amount + 0.5) : amount, max, floorOf(option));
    } else if (option.kind === "manacost") {
        // Overriding the number itself updates the tooltip; the percentage hook changed the cost but not the tooltip
        setBoostValue(hero, option.ability, "AbilityManaCost", effect);
    } else {
        setBoostField(hero, option.ability, option.kind, effect);
        // A spell whose reach is a value (a hook's distance) needs that value raised too, or the range only changes on paper
        if (option.rangeValue !== undefined && option.base > 0) {
            setBoostValue(hero, option.ability, option.rangeValue, (option.base + effect) / option.base);
        }
    }
    moveLinkedVision(hero, option, effect);
}

/**
 * Moves the option's power by one click of `size` (see clickSize), scaled by `multiplier` (from the rarity), in
 * `direction` (+1 or -1) and writes the boost. Returns false if it is already at its limit in that direction.
 */
export function changePower(hero: CDOTA_BaseNPC, option: UpgradeOption, direction: number, multiplier: number, size = clickSize()): boolean {
    if (!canChange(hero, option, direction)) return false;
    const key = heroKey(hero);
    const power = movedPower(option, powers[key]?.[option.id] ?? 0, direction, multiplier, size, powerLimits(hero, option));
    setPower(hero, option, power);
    return true;
}

/**
 * Jumps the option's power straight to its current limit in `direction` (the "max now" number from boost_audit),
 * skipping the normal click-by-click movement (counts move by exactly 1 per real click; this ignores that).
 * Debug only. Returns false if it is already there.
 */
export function maxOut(hero: CDOTA_BaseNPC, option: UpgradeOption, direction: number): boolean {
    if (!canChange(hero, option, direction)) return false;
    const { low, high } = powerLimits(hero, option);
    setPower(hero, option, direction > 0 ? high : low);
    return true;
}

/** Gives the vision values that follow this stat the same multiplier (see visionLinks). */
function moveLinkedVision(hero: CDOTA_BaseNPC, option: UpgradeOption, effect: number) {
    const ability = hero.FindAbilityByName(option.ability);
    if (ability === undefined) return;
    let partners: string[];
    let multiplier: number;
    if (option.kind === "value") {
        partners = [option.valueName!];
        multiplier = effect;
    } else if (option.kind === "castrange" && option.base > 0) {
        // Cast range is stored as extra units; vision follows the same share
        partners = option.rangeValue !== undefined ? ["castrange", option.rangeValue] : ["castrange"];
        multiplier = (option.base + effect) / option.base;
    } else {
        return;
    }
    for (const [vision, partner] of Object.entries(visionLinks(ability))) {
        if (partners.includes(partner)) setBoostValue(hero, option.ability, vision, multiplier);
    }
}

/**
 * Moves the option one click in its good direction (used by bots and the debug commands).
 * Returns the new multiplier, or the flat bonus for cast range.
 */
export function applyUpgrade(hero: CDOTA_BaseNPC, option: UpgradeOption, multiplier = 1, size = clickSize()): number {
    changePower(hero, option, goodDelta(option), multiplier, size);
    return effectOf(option, getPower(hero, option));
}

/** Removes all modifications of a hero, or of one ability. */
export function resetUpgrades(hero: CDOTA_BaseNPC, abilityName?: string) {
    const key = heroKey(hero);
    if (abilityName === undefined) {
        powers[key] = {};
        timesModified[key] = {};
    } else {
        for (const id in powers[key] ?? {}) {
            if (id.startsWith(`${abilityName}:`)) delete powers[key][id];
        }
        if (timesModified[key] !== undefined) delete timesModified[key][abilityName];
    }
    resetBoosts(hero, abilityName);
}
