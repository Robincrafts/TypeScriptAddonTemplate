// Everyone's buffs (G1, user 2026-09-30: both teams see all of them): one summary per player's hero, published to
// the boost_summary net table for the buffs view in the HUD. Rebuilt only when that hero's buffs, skill levels,
// Scepter or Shard change (a cheap signature checked by the game tick), never every second.
import { buffsSignature, describeBoughtBuffs } from "./upgrade_engine";

const TABLE = "boost_summary";

// playerId (as string) -> signature at the last publish
const published: Record<string, string> = {};

/** Called every second by the game tick: republishes the heroes whose buffs changed. */
export function refreshBuffSummaries() {
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (!PlayerResource.IsValidPlayerID(playerId)) continue;
        const hero = PlayerResource.GetSelectedHeroEntity(playerId);
        if (hero === undefined) continue;
        const key = tostring(playerId);
        const signature = `${hero.GetUnitName()}#${buffsSignature(hero)}`;
        if (published[key] === signature) continue;
        published[key] = signature;
        CustomNetTables.SetTableValue(TABLE, key, { hero: hero.GetUnitName(), buffs: describeBoughtBuffs(hero) });
    }
}
