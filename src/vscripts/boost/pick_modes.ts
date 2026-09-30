// Hero pick modes, one per map (G2, user 2026-09-30: like Overthrow's map choices in the lobby, not a host setting).
// The lobby's map decides the mode:
//   all_pick     - normal Dota pick (also any other map name, e.g. the old "dota" map)
//   single_draft - every player may only pick from their own few heroes: one of each primary attribute, and no two
//                  players get the same hero
//   all_random   - every player gets a random hero the moment hero selection starts
// Bots added in tools mode come with fixed heroes and are left alone.
//
// In every mode a player who has not picked when the timer runs out gets a random hero (user 2026-09-30: without it
// they entered the game with no hero): randomUnpicked just before the timer ends, when hero selection ends, and once
// more in the pre-game. It only asks Dota for a random pick and never creates a hero itself: a pre-game fallback that
// did (CreateHeroForPlayer when a player had no hero entity yet) gave everyone a SECOND hero in a real online game,
// where heroes spawn later than in tools mode (user 2026-09-30: extra heroes on both sides, a free kill).

export type PickMode = "all_pick" | "single_draft" | "all_random";

/** The mode of the map this match runs on. */
export function pickMode(): PickMode {
    const map = GetMapName();
    if (map.includes("single_draft")) return "single_draft";
    if (map.includes("all_random")) return "all_random";
    return "all_pick";
}

/** Primary attributes of a Single Draft pool, one hero each */
const DRAFT_ATTRIBUTES = ["DOTA_ATTRIBUTE_STRENGTH", "DOTA_ATTRIBUTE_AGILITY", "DOTA_ATTRIBUTE_INTELLECT", "DOTA_ATTRIBUTE_ALL"];

interface HeroEntry {
    name: string;
    id: number;
    attribute: string;
}

/** Every pickable hero with its id and primary attribute, from Dota's hero list. */
function allHeroes(): HeroEntry[] {
    const heroes: HeroEntry[] = [];
    const keyValues = LoadKeyValues("scripts/npc/npc_heroes.txt") as Record<string, any>;
    for (const [name, data] of pairs(keyValues)) {
        if (typeof data !== "object" || !name.startsWith("npc_dota_hero_") || name === "npc_dota_hero_base") continue;
        const id = tonumber(data.HeroID);
        if (id === undefined || name.includes("target_dummy")) continue;
        heroes.push({ name, id, attribute: tostring(data.AttributePrimary ?? "") });
    }
    return heroes;
}

function humanPlayers(): PlayerID[] {
    const players: PlayerID[] = [];
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (PlayerResource.IsValidPlayerID(playerId) && !PlayerResource.IsFakeClient(playerId)) players.push(playerId);
    }
    return players;
}

/** Call once at start-up: Single Draft limits which heroes each player may pick. */
export function registerPickMode() {
    print(`[pick] map ${GetMapName()}: ${pickMode()}`);
    if (pickMode() === "single_draft") GameRules.GetGameModeEntity().SetPlayerHeroAvailabilityFiltered(true);
}

/** Call when hero selection starts. `seconds` is the hero selection time. */
export function startPickMode(seconds: number) {
    const mode = pickMode();
    // Dota does not random for a player without a hero here, so do it a moment before the timer ends
    Timers.CreateTimer(math.max(seconds - 1, 0), () => {
        if (GameRules.State_Get() === GameState.HERO_SELECTION) randomUnpicked();
    });
    if (mode === "all_random") {
        for (const playerId of humanPlayers()) PlayerResource.GetPlayer(playerId)?.MakeRandomHeroSelection();
    } else if (mode === "single_draft") {
        dealDrafts();
    }
}

/** Every human player who has not picked a hero gets a random one (Single Draft: from their own heroes). */
export function randomUnpicked() {
    for (const playerId of humanPlayers()) {
        if (PlayerResource.HasSelectedHero(playerId)) continue;
        const player = PlayerResource.GetPlayer(playerId);
        if (player === undefined) continue;
        print(`[pick] player ${playerId} has no hero: random pick`);
        player.MakeRandomHeroSelection();
    }
}

/** Gives every human player one random hero of each primary attribute; a hero is dealt to one player only. */
function dealDrafts() {
    const unused = allHeroes();
    for (const playerId of humanPlayers()) {
        GameRules.ClearPlayerHeroAvailability(playerId);
        const dealt: string[] = [];
        for (const attribute of DRAFT_ATTRIBUTES) {
            const choices = unused.filter(hero => hero.attribute === attribute);
            if (choices.length === 0) continue;
            const hero = choices[RandomInt(0, choices.length - 1)];
            unused.splice(unused.indexOf(hero), 1);
            GameRules.AddHeroToPlayerAvailability(playerId, hero.id);
            dealt.push(hero.name);
        }
        print(`[pick] single draft for player ${playerId}: ${dealt.join(", ")}`);
    }
}
