// Stores per-hero ability boosts. The server owns the data and mirrors it to a custom net table,
// so modifier functions (which run on both server and client) read the same numbers.

const TABLE = "boost_upgrades";

// Server-side source of truth. Reading goes through the net table so the same code works on clients.
const serverBoosts: Record<string, HeroBoosts> = {};

function key(hero: CDOTA_BaseNPC): string {
    return tostring(hero.GetEntityIndex());
}

// Client copy of each hero's boosts. Modifier hooks run thousands of times a second and every net table read
// builds a new Lua table (late games lagged), so clients re-read the table at most twice a second.
const CLIENT_REFRESH_SECONDS = 0.5;
const clientCache: Record<string, { boosts: HeroBoosts | undefined; readAt: number }> = {};

/** Works on server and client. The server gets its live data: do not change it. */
export function getHeroBoosts(hero: CDOTA_BaseNPC): HeroBoosts | undefined {
    const heroKey = key(hero);
    if (IsServer()) return serverBoosts[heroKey];

    const now = Time();
    const cached = clientCache[heroKey];
    if (cached !== undefined && now - cached.readAt < CLIENT_REFRESH_SECONDS) return cached.boosts;

    const boosts = CustomNetTables.GetTableValue(TABLE, heroKey) as HeroBoosts | undefined;
    clientCache[heroKey] = { boosts, readAt: now };
    return boosts;
}

/** Works on server and client */
export function getAbilityBoost(hero: CDOTA_BaseNPC, abilityName: string): AbilityBoost | undefined {
    return getHeroBoosts(hero)?.[abilityName] as AbilityBoost | undefined;
}

function publish(hero: CDOTA_BaseNPC) {
    CustomNetTables.SetTableValue(TABLE, key(hero), serverBoosts[key(hero)]);
}

function boostFor(hero: CDOTA_BaseNPC, abilityName: string): AbilityBoost {
    const heroKey = key(hero);
    serverBoosts[heroKey] ??= {};
    serverBoosts[heroKey][abilityName] ??= {};
    return serverBoosts[heroKey][abilityName];
}

export type SimpleBoostField = "cooldown" | "casttime" | "manacost" | "castrange";

/** Server only */
export function setBoostField(hero: CDOTA_BaseNPC, abilityName: string, field: SimpleBoostField, value: number) {
    boostFor(hero, abilityName)[field] = value;
    publish(hero);
}

/** Server only */
export function setBoostValue(hero: CDOTA_BaseNPC, abilityName: string, valueName: string, multiplier: number) {
    const boost = boostFor(hero, abilityName);
    boost.values ??= {};
    boost.values[valueName] = multiplier;
    publish(hero);
}

/**
 * Server only. The amount added to one ability value at every level (0 removes nothing: the value stays listed).
 * `max` is the highest size the value may reach at any level, `floor` the lowest multiple of its normal number.
 */
export function setBoostAdd(hero: CDOTA_BaseNPC, abilityName: string, valueName: string, amount: number, max?: number, floor?: number) {
    const boost = boostFor(hero, abilityName);
    boost.adds ??= {};
    boost.adds[valueName] = amount;
    if (max !== undefined) {
        boost.maxes ??= {};
        boost.maxes[valueName] = max;
    }
    if (floor !== undefined) {
        boost.floors ??= {};
        boost.floors[valueName] = floor;
    }
    publish(hero);
}

/** Pseudo ability that carries how many of each Invoker orb are up (values.quas / wex / exort), for the clients. */
export const ORB_COUNTS = "_invoker_orbs";

/**
 * Server only. Invoker's orb counts, published only when they change: clients cannot count modifiers themselves, but
 * need the counts to show the orb buffs (modifier_boost) in the HUD.
 */
export function setOrbCount(hero: CDOTA_BaseNPC, orb: string, count: number) {
    const boost = boostFor(hero, ORB_COUNTS);
    boost.values ??= {};
    if (boost.values[orb] === count) return;
    boost.values[orb] = count;
    publish(hero);
}

/** Server only. Without abilityName, clears every boost of the hero. */
export function resetBoosts(hero: CDOTA_BaseNPC, abilityName?: string) {
    const heroKey = key(hero);
    if (abilityName === undefined) {
        serverBoosts[heroKey] = {};
    } else if (serverBoosts[heroKey] !== undefined) {
        delete serverBoosts[heroKey][abilityName];
    }
    serverBoosts[heroKey] ??= {};
    publish(hero);
}
