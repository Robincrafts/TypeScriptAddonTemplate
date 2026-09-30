// Shop settings from the setup menu: universal shop, and the minute from which Aghanim's Shard can be bought.
// Dota sells the shard through its shop stock: none at first, the first one at 15:00 game time, at most 1.
// To sell it earlier we keep that stock at 1 from the host's minute until Dota's own restocking takes over.
import { config } from "./config";

const SHARD = "item_aghanims_shard";
const DOTA_SHARD_MINUTE = 15;

/** Turbo-style shop: Secret Shop items at any shop, and bought from a lane they go to the stash (tested). */
export function applyUniversalShop() {
    GameRules.SetUseUniversalShopMode(config.universalShop === 1);
}

// --- Selling from anywhere ---
// Dota does not send the normal sell order away from shops, but its "Mark for Sell" menu entry (sell at the next
// shop) does reach the server. That order is newer than our API type list, so it is recognised as an order number
// above the known ones (CONSUME_ITEM = 41) that comes with an item; the item is then sold on the spot.
const LAST_KNOWN_ORDER = 41;

/** Sells an item like Dota does: full price within 10 seconds of buying, half after. Returns true if it sold. */
function sellItemAnywhere(event: ExecuteOrderFilterEvent): boolean {
    const unit = EntIndexToHScript(event.units["0"]) as CDOTA_BaseNPC | undefined;
    const item = EntIndexToHScript(event.entindex_ability) as CDOTA_Item | undefined;
    if (unit === undefined || item === undefined || !item.IsItem()) return false;
    print(`[shop] order ${event.order_type} with item ${item.GetAbilityName()} (treated as Mark for Sell)`);

    const playerId = event.issuer_player_id_const;
    const hero = PlayerResource.GetSelectedHeroEntity(playerId);
    // Only your own sellable items; at a shop Dota's own selling works, so leave it alone there
    const refuse = (reason: string) => {
        print(`[shop] not sold here: ${reason}`);
        return false;
    };
    if (hero === undefined) return refuse("no hero");
    if (item.GetPurchaser()?.GetEntityIndex() !== hero.GetEntityIndex()) return refuse("bought by someone else");
    if (!item.IsSellable()) return refuse("Dota does not allow selling it");
    if (unit.IsInRangeOfShop(ShopType.HOME, true)) return refuse("at a shop, Dota sells it");

    const cost = item.GetCost();
    const value = GameRules.GetGameTime() - item.GetPurchaseTime() <= 10 ? cost : math.floor(cost / 2);
    // Read the name first: the item is gone after RemoveItem
    const name = item.GetAbilityName();
    unit.RemoveItem(item);
    PlayerResource.ModifyGold(playerId, value, false, ModifyGoldReason.SELL_ITEM);
    // Dota's sell sound "General.Sell" (in game_sounds_ui_imported) stayed silent when the server played it with
    // EmitSoundOnClient, so the player's UI plays it (hud.ts)
    const player = PlayerResource.GetPlayer(playerId);
    if (player !== undefined) CustomGameEventManager.Send_ServerToPlayer(player, "boost_item_sold", {});
    print(`[shop] sold ${name} away from shops for ${value} gold (player ${playerId})`);
    return true;
}

/**
 * Tools mode: prints every uncommon order with all its fields, to find new order types (like Mark for Sell above).
 * Picking an Aghanim's Scepter option sent NO order of its own (2026-09-30), so buying, training and "continue" are
 * left out as noise.
 */
const commonOrders = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 16, 21, 28, 29, 33, 39];
function logOrder(event: ExecuteOrderFilterEvent) {
    if (!IsInToolsMode() || commonOrders.includes(event.order_type)) return;
    const ability = EntIndexToHScript(event.entindex_ability) as CDOTABaseAbility | undefined;
    const parts: string[] = [];
    for (const [key, value] of pairs(event as any)) {
        if (typeof value !== "object") parts.push(`${tostring(key)}=${tostring(value)}`);
    }
    print(`[order] type ${event.order_type}${ability !== undefined ? ` ability ${ability.GetAbilityName()}` : ""}: ${parts.join(", ")}`);
}

/** Call once when the game mode is set up. */
export function registerSellAnywhere(mode: CDOTABaseGameMode) {
    mode.SetExecuteOrderFilter(event => {
        logOrder(event);
        if (event.order_type > LAST_KNOWN_ORDER && sellItemAnywhere(event)) return false;
        return true;
    }, {});
}

function fillShardStock() {
    for (const team of [DotaTeam.GOODGUYS, DotaTeam.BADGUYS]) {
        for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
            if (!PlayerResource.IsValidPlayerID(playerId) || PlayerResource.GetTeam(playerId) !== team) continue;
            if (GameRules.GetItemStockCount(team, SHARD, playerId) < 1) {
                GameRules.SetItemStockCount(1, team, SHARD, playerId);
            }
        }
    }
}

/** Called every second by the game tick. Does nothing when the host keeps Dota's normal 15 minutes. */
export function tickEarlyShard() {
    if (config.shardMinute >= DOTA_SHARD_MINUTE) return;
    const minutes = GameRules.GetDOTATime(false, true) / 60;
    // From Dota's own minute on, Dota restocks it by itself
    if (minutes >= config.shardMinute && minutes < DOTA_SHARD_MINUTE) fillShardStock();
}

// --- Buying while dead ---
// A dead hero's purchases land in the stash and the courier carries them out, so they reach the hero long after it
// respawned at the fountain. Instead they go straight into the hero's inventory or backpack when there is room.
const INVENTORY_SLOTS = 9; // 6 inventory + 3 backpack (slots 0-8)
const STASH_FIRST = 9;
const STASH_LAST = 14;

/** A free inventory or backpack slot of the hero, or undefined when both are full. */
function freeSlot(hero: CDOTA_BaseNPC): number | undefined {
    for (let slot = 0; slot < INVENTORY_SLOTS; slot++) {
        if (hero.GetItemInSlot(slot) === undefined) return slot;
    }
    return undefined;
}

/** Just bought (within the last 2 s) and named like the purchase. */
function isFreshPurchase(item: CDOTA_Item | undefined, name: string): item is CDOTA_Item {
    return item !== undefined && item.GetAbilityName() === name && GameRules.GetGameTime() - item.GetPurchaseTime() <= 2;
}

function moveToInventory(hero: CDOTA_BaseNPC_Hero, name: string) {
    const slot = freeSlot(hero);
    if (slot === undefined) return;

    // In the stash: a swap within the hero's own slots
    for (let stash = STASH_FIRST; stash <= STASH_LAST; stash++) {
        if (isFreshPurchase(hero.GetItemInSlot(stash), name)) {
            hero.SwapItems(stash, slot);
            print(`[shop] ${name} bought while dead: moved from stash to the hero`);
            return;
        }
    }

    // Already picked up by the courier
    const courier = PlayerResource.GetPreferredCourierForPlayer(hero.GetPlayerOwnerID()) as CDOTA_BaseNPC | undefined;
    if (courier === undefined) return;
    for (let courierSlot = 0; courierSlot < INVENTORY_SLOTS; courierSlot++) {
        const item = courier.GetItemInSlot(courierSlot);
        if (isFreshPurchase(item, name)) {
            courier.TakeItem(item);
            hero.AddItem(item);
            print(`[shop] ${name} bought while dead: moved from the courier to the hero`);
            return;
        }
    }
}

/** Call once when the game mode is set up. */
export function registerDeadPurchases() {
    ListenToGameEvent(
        "dota_item_purchased",
        event => {
            const hero = PlayerResource.GetSelectedHeroEntity(event.PlayerID);
            if (hero === undefined || hero.IsAlive()) return;
            // Teleport Scrolls have their own slot; Dota handles those
            if (event.itemname === "item_tpscroll") return;
            // The item reaches the stash (or the courier) a moment after the event
            Timers.CreateTimer(0.1, () => moveToInventory(hero, event.itemname));
        },
        undefined,
    );
}
