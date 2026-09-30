// Server side of the "Modify" list UI. Every human player gets an offer of config.rowsPerList random boostables, each
// with a random rarity. Each row has an increase and a decrease button (the player decides which helps; a rarer row
// moves it further); either costs one upgrade of points, and after each one the offer is re-rolled.
// The client only sends which row and which direction; the server checks the row is really in the
// player's offer and that the player can pay.
import { rarityOrder } from "../game_settings";
import {
    canMoveBothWays,
    changePower,
    describeRow,
    findOption,
    getHeroOptions,
    rarityMultiplier,
    rollOptions,
    rollRarity,
} from "./upgrade_engine";
import { affordableSize, nextBuffEarnedAt, nextClickSize, spendForUpgrade } from "./points";
import { StatGroup, statGroup } from "./stat_types";
import { config } from "./config";

const TABLE = "boost_options";

interface Offer {
    /** Option ids currently on offer, in display order */
    ids: string[];
    /** Rarity of each row, rolled when the row joined the offer */
    rarities: Record<string, Rarity>;
    /** Rarities this list may not roll because the previous list had them (epic, legendary) */
    blocked?: Rarity[];
}

// playerId (as string) -> offer
const offers: Record<string, Offer> = {};

// --- Variety: no buff type three times in a row ---
// At most MAX_SAME_TYPE rows of one type (damage, disable, area...) in a list, and a type that was in each of the last
// two lists is left out of the next one. When the hero has too few types to fill the list, the rules relax.
const MAX_SAME_TYPE = 2;

// playerId (as string) -> buff types of the last two lists (oldest first)
const recentTypes: Record<string, StatGroup[][]> = {};

function typeOf(option: UpgradeOption): StatGroup {
    return statGroup(option.ability, option.valueName ?? option.kind);
}

/** Remembers the types of a list that is about to be re-rolled. */
function rememberTypes(playerId: PlayerID, offer: Offer, existing: Record<string, UpgradeOption>) {
    const types: StatGroup[] = [];
    for (const id of offer.ids) {
        const option = existing[id];
        if (option !== undefined && !types.includes(typeOf(option))) types.push(typeOf(option));
    }
    const key = tostring(playerId);
    recentTypes[key] = [...(recentTypes[key] ?? []), types].slice(-2);
}

// --- Scepter / Shard stats only for buffs earned after the item ---
// Otherwise a player banks points, buys the item and spends them all on its new stats (user 2026-09-30). The game time
// each item was first seen on the hero; a buff that became affordable before that cannot roll the item's stats.

// playerId (as string) -> item -> game time first owned
const itemSince: Record<string, Partial<Record<"scepter" | "shard", number>>> = {};

function noteItems(playerId: PlayerID, hero: CDOTA_BaseNPC) {
    const key = tostring(playerId);
    itemSince[key] ??= {};
    if (hero.HasScepter()) itemSince[key].scepter ??= GameRules.GetGameTime();
    if (hero.HasModifier("modifier_item_aghanims_shard")) itemSince[key].shard ??= GameRules.GetGameTime();
}

/** Whether the player's next buff may roll this stat: an item's stat only if the buff was earned after the item. */
function itemAllowed(playerId: PlayerID, option: UpgradeOption): boolean {
    if (option.item === undefined) return true;
    const since = itemSince[tostring(playerId)]?.[option.item];
    return since !== undefined && nextBuffEarnedAt(playerId) >= since;
}

/** Picks one more row for the list, keeping the variety rules when the hero has enough other stats. */
function rollVariedRow(playerId: PlayerID, hero: CDOTA_BaseNPC, offer: Offer, existing: Record<string, UpgradeOption>, rarity: Rarity) {
    const counts: Partial<Record<StatGroup, number>> = {};
    for (const id of offer.ids) {
        const option = existing[id];
        if (option !== undefined) counts[typeOf(option)] = (counts[typeOf(option)] ?? 0) + 1;
    }
    const [older, newer] = recentTypes[tostring(playerId)] ?? [];
    const inBoth = (type: StatGroup) => older !== undefined && newer !== undefined && older.includes(type) && newer.includes(type);
    const notTooMany = (option: UpgradeOption) => (counts[typeOf(option)] ?? 0) < MAX_SAME_TYPE;
    const allowed = (option: UpgradeOption) => itemAllowed(playerId, option);

    return (
        rollOptions(hero, 1, offer.ids, rarity, option => allowed(option) && notTooMany(option) && !inBoth(typeOf(option)))[0] ??
        rollOptions(hero, 1, offer.ids, rarity, option => allowed(option) && notTooMany(option))[0] ??
        rollOptions(hero, 1, offer.ids, rarity, allowed)[0]
    );
}

// --- Rarity mix per list ---
// At most 3 rare, 2 epic and 2 legendary rows in one list, and at least 1 common (the last free row is forced common).
// Epic and legendary never come in two lists in a row: a list with a legendary row is followed by one without
// legendary, the same for epic (user 2026-09-29; Offer.blocked).
const MAX_PER_RARITY: Partial<Record<Rarity, number>> = { rare: 3, epic: 2, legendary: 2 };
const MIN_COMMON = 1;
const NO_REPEAT: Rarity[] = ["epic", "legendary"];

/** The rarities of NO_REPEAT that a list has: the next list may not have them. */
function repeatBlocked(offer: Offer): Rarity[] {
    return NO_REPEAT.filter(rarity => offer.ids.some(id => offer.rarities[id] === rarity));
}

/** Rolls the rarity of the next row of the list, keeping the rarity mix. */
function rollListRarity(offer: Offer): Rarity {
    const counts: Partial<Record<Rarity, number>> = {};
    let rolled = 0;
    for (const id of offer.ids) {
        const rarity = offer.rarities[id];
        if (rarity === undefined) continue;
        counts[rarity] = (counts[rarity] ?? 0) + 1;
        rolled++;
    }
    const commonsMissing = MIN_COMMON - (counts.common ?? 0);
    if (commonsMissing > 0 && config.rowsPerList - rolled <= commonsMissing) return "common";
    return rollRarity(rarity => (counts[rarity] ?? 0) < (MAX_PER_RARITY[rarity] ?? config.rowsPerList) && !(offer.blocked ?? []).includes(rarity));
}

// playerId (as string) -> menuSignature at the last publish
const signatures: Record<string, string> = {};

/** Every option of the hero by id (also ones at their limit). One KV scan, reused for the whole refresh. */
function optionsById(hero: CDOTA_BaseNPC): Record<string, UpgradeOption> {
    const byId: Record<string, UpgradeOption> = {};
    for (const group of getHeroOptions(hero, true)) {
        for (const option of group) byId[option.id] = option;
    }
    return byId;
}

/**
 * Keeps the offer valid: drops options that vanished or reached their limit, and fills up new ones if there are fewer
 * rows than wanted. New rolls never offer a stat at its limit (getHeroOptions); its ceiling grows with game time, so
 * it can come back in a later list.
 */
function updateOffer(playerId: PlayerID, hero: CDOTA_BaseNPC, existing: Record<string, UpgradeOption>): Offer {
    const key = tostring(playerId);
    offers[key] ??= { ids: [], rarities: {} };
    const offer = offers[key];

    // A row already on the list can reach its limit without a re-roll (a level-up pushes a radius to 1200, boost_max):
    // only that row is replaced, by another stat of the same rarity, so the player neither loses the slot's rarity nor
    // gets a free re-roll of the others (user 2026-09-29)
    const freedRarities: Rarity[] = [];
    offer.ids = offer.ids.filter(id => {
        const option = existing[id];
        if (option === undefined) return false;
        if (canMoveBothWays(hero, option)) return true;
        freedRarities.push(offer.rarities[id] ?? "common");
        return false;
    });

    // Abilities trained after the roll can still join an offer that has room. Each new row rolls its rarity first
    // (kept until the offer is re-rolled), then a stat that may appear at that rarity (counts only epic or better)
    while (offer.ids.length < config.rowsPerList) {
        let rarity = freedRarities.shift() ?? rollListRarity(offer);
        let option = rollVariedRow(playerId, hero, offer, existing, rarity);
        // No stat left for a kept rarity (e.g. only counts could fill it): roll the rarity again
        if (option === undefined) {
            rarity = rollListRarity(offer);
            option = rollVariedRow(playerId, hero, offer, existing, rarity);
        }
        if (option === undefined) break;
        offer.ids.push(option.id);
        offer.rarities[option.id] = rarity;
    }
    for (const id of offer.ids) offer.rarities[id] ??= rollListRarity(offer);
    return offer;
}

/** Recomputes and publishes the offer of one player. */
export function refreshMenu(playerId: PlayerID) {
    if (!PlayerResource.IsValidPlayerID(playerId) || PlayerResource.IsFakeClient(playerId)) return;

    const hero = PlayerResource.GetSelectedHeroEntity(playerId);
    if (hero === undefined) return;

    noteItems(playerId, hero);
    const existing = optionsById(hero);
    const offer = updateOffer(playerId, hero, existing);
    const rows: ModifyRow[] = [];
    for (const id of offer.ids) {
        const option = existing[id] ?? findOption(hero, id);
        if (option !== undefined) rows.push(describeRow(hero, option, offer.rarities[id], nextClickSize(playerId)));
    }
    // Rarest first: legendary, epic, rare, common
    const sorted: ModifyRow[] = [];
    for (let i = rarityOrder.length - 1; i >= 0; i--) {
        for (const row of rows) if (row.rarity === rarityOrder[i]) sorted.push(row);
    }
    // Diagnostic for the "list empty until a skill is learned" report: should never print once the hero exists
    if (sorted.length === 0) print(`[boost] menu of player ${playerId} has no rows (hero ${hero.GetUnitName()}, level ${hero.GetLevel()})`);
    CustomNetTables.SetTableValue(TABLE, tostring(playerId), { rows: sorted });
    signatures[tostring(playerId)] = menuSignature(playerId, hero);
}

function onBuy(playerId: PlayerID, optionId: string, direction: number) {
    if (direction !== 1 && direction !== -1) return;

    const hero = PlayerResource.GetSelectedHeroEntity(playerId);
    if (hero === undefined) return;

    // Only rows that are really on offer to this player can be bought
    const offer = offers[tostring(playerId)];
    if (offer === undefined || !offer.ids.includes(optionId)) return;

    const option = findOption(hero, optionId);
    if (option === undefined) return;

    // Check the limit first so a click on a row at its limit does not cost points
    const rarity = offer.rarities[optionId] ?? "common";
    const before = describeRow(hero, option, rarity);
    if (direction === 1 ? !before.canUp : !before.canDown) return;
    // The buff keeps the size it got when the player could first afford it, so waiting does not make it bigger
    const size = spendForUpgrade(playerId);
    if (size === undefined) return;

    changePower(hero, option, direction, rarityMultiplier(rarity), size);

    // After each spent upgrade the whole offer, rarities included, is re-rolled
    rememberTypes(playerId, offer, optionsById(hero));
    offers[tostring(playerId)] = { ids: [], rarities: {}, blocked: repeatBlocked(offer) };
    refreshMenu(playerId);
}

export function registerUpgradeUi() {
    CustomGameEventManager.RegisterListener("boost_buy_upgrade", (_, event) =>
        onBuy(event.PlayerID, event.optionId, event.direction),
    );

}

/**
 * Everything the menu depends on, as one short text: the hero's abilities and their levels (learning, leveling,
 * talents, stolen spells), Shard and Scepter, and the size of the buff the player can afford (the list is hidden
 * while they cannot, so the size growing with game time does not matter then). Cheap: no KV reads.
 */
function menuSignature(playerId: PlayerID, hero: CDOTA_BaseNPC): string {
    const parts: string[] = [];
    for (let i = 0; i < hero.GetAbilityCount(); i++) {
        const ability = hero.GetAbilityByIndex(i);
        if (ability !== undefined) parts.push(`${ability.GetAbilityName()}=${ability.GetLevel()}`);
    }
    parts.push(`scepter=${hero.HasScepter()}`, `shard=${hero.HasModifier("modifier_item_aghanims_shard")}`);
    parts.push(`size=${affordableSize(playerId) ?? "-"}`);
    return parts.join(",");
}

/** Called every second by the game tick: republishes a player's menu only when something it shows has changed. */
export function refreshChangedMenus() {
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (!PlayerResource.IsValidPlayerID(playerId) || PlayerResource.IsFakeClient(playerId)) continue;
        const hero = PlayerResource.GetSelectedHeroEntity(playerId);
        if (hero === undefined) continue;
        if (menuSignature(playerId, hero) !== signatures[tostring(playerId)]) refreshMenu(playerId);
    }
}
