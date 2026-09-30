// Upgrade points economy: players earn points from kills and time, and spend them on upgrades.
// State is kept here on the server and mirrored to a net table for the UI.
import { PointsSettings } from "../game_settings";
import { config, publishConfig } from "./config";
import { applyUpgrade, clickSize, rarityMultiplier, rollOptions, rollRarity } from "./upgrade_engine";

const TABLE = "boost_points";

interface PointsState {
    points: number;
    earned: number;
    upgrades: number;
    /**
     * Click size of each buff the player can afford, oldest first, taken at the moment it became affordable.
     * Buffs grow over the game, so saving points to spend later must not make them bigger.
     */
    sizes: number[];
    /** Game time each of those buffs became affordable (same order): Scepter/Shard stats only for buffs earned later */
    earnedAt: number[];
    /** The last RECENT_EVENTS honey gains, newest first (A2) */
    recent: HoneyEvent[];
}

/** Honey gains shown in the honey log next to the BUFF tab; the passive gain ("time") and debug points are left out */
const RECENT_EVENTS = 10;

// playerId (as string) -> state
const players: Record<string, PointsState> = {};

function stateOf(playerId: PlayerID): PointsState {
    const key = tostring(playerId);
    players[key] ??= { points: 0, earned: 0, upgrades: 0, sizes: [], earnedAt: [], recent: [] };
    return players[key];
}

/** How many times the cost has stepped up with game time (one step every 5 minutes). */
function costStep(): number {
    return math.max(math.floor(GameRules.GetDOTATime(false, false) / 300), 0);
}

/** Price of a buff after `upgradesDone` buffs, at the current game time. */
function costOf(upgradesDone: number): number {
    return config.upgradeBaseCost + config.upgradeCostGrowth * upgradesDone + config.upgradeCostPer5Minutes * costStep();
}

export function getUpgradeCost(playerId: PlayerID): number {
    return costOf(stateOf(playerId).upgrades);
}

export function getPoints(playerId: PlayerID): PlayerPoints {
    const state = stateOf(playerId);
    return { points: state.points, earned: state.earned, upgrades: state.upgrades, cost: getUpgradeCost(playerId), recent: state.recent };
}

function publish(playerId: PlayerID) {
    CustomNetTables.SetTableValue(TABLE, tostring(playerId), getPoints(playerId));
}

// The "boost points multiplier" of the setup menu; the boost_pointrate command changes it during a match
export function setPointRate(rate: number) {
    config.pointsMultiplier = rate;
    publishConfig();
}

export function getPointRate(): number {
    return config.pointsMultiplier;
}

/** Adds points (fractions are kept). Every source except "debug" is multiplied by the boost points multiplier. */
export function addPoints(playerId: PlayerID, rawAmount: number, reason: string) {
    if (!PlayerResource.IsValidPlayerID(playerId) || rawAmount <= 0) return;
    const amount = reason === "debug" ? rawAmount : rawAmount * config.pointsMultiplier;
    if (amount <= 0) return;

    const state = stateOf(playerId);
    state.points += amount;
    state.earned += amount;
    if (reason !== "time" && reason !== "debug" && !PlayerResource.IsFakeClient(playerId)) {
        state.recent.unshift({ amount, reason, time: GameRules.GetDOTATime(false, false) });
        while (state.recent.length > RECENT_EVENTS) state.recent.pop();
    }
    stampSizes(state);
    publish(playerId);

    if (PointsSettings.debugLog && !PlayerResource.IsFakeClient(playerId) && reason !== "time") {
        print(`[points] +${string.format("%.1f", amount)} (${reason}) -> ${string.format("%.1f", state.points)}/${getUpgradeCost(playerId)}`);
    }

    if (PointsSettings.botsAutoUpgrade && PlayerResource.IsFakeClient(playerId)) botSpend(playerId);
}

/**
 * Gives every newly affordable buff the click size of this moment. When the price went up and a buff is no longer
 * affordable, its size is dropped too (it gets a new one once it is affordable again).
 */
function stampSizes(state: PointsState) {
    let remaining = state.points;
    let affordable = 0;
    while (remaining >= costOf(state.upgrades + affordable)) {
        remaining -= costOf(state.upgrades + affordable);
        affordable++;
    }
    while (state.sizes.length < affordable) state.sizes.push(clickSize());
    while (state.sizes.length > affordable) state.sizes.pop();
    while (state.earnedAt.length < affordable) state.earnedAt.push(GameRules.GetGameTime());
    while (state.earnedAt.length > affordable) state.earnedAt.pop();
}

/** Game time the player's next buff became affordable (now if it is not affordable yet). */
export function nextBuffEarnedAt(playerId: PlayerID): number {
    return stateOf(playerId).earnedAt[0] ?? GameRules.GetGameTime();
}

let lastCostStep = 0;

/** Called every second by the game tick: when the price steps up, every player's cost and affordable buffs are updated. */
export function checkCostStep() {
    const step = costStep();
    if (step === lastCostStep) return;
    lastCostStep = step;
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (!PlayerResource.IsValidPlayerID(playerId)) continue;
        stampSizes(stateOf(playerId));
        publish(playerId);
    }
}

/** The click size the player's next buff will have: the one it got when it became affordable. */
export function nextClickSize(playerId: PlayerID): number {
    return stateOf(playerId).sizes[0] ?? clickSize();
}

/**
 * Pays for the next upgrade. Returns the click size that buff got when it became affordable,
 * or undefined (and takes nothing) if the player cannot afford it.
 */
export function spendForUpgrade(playerId: PlayerID): number | undefined {
    const state = stateOf(playerId);
    const cost = getUpgradeCost(playerId);
    if (state.points < cost) return undefined;

    state.points -= cost;
    state.upgrades += 1;
    const size = state.sizes.shift() ?? clickSize();
    state.earnedAt.shift();
    publish(playerId);
    return size;
}

function botSpend(playerId: PlayerID) {
    const hero = PlayerResource.GetSelectedHeroEntity(playerId);
    if (hero === undefined) return;

    // Checked before rolling: a roll scans every ability's KVs, and this runs on every creep kill and passive tick
    while (stateOf(playerId).points >= getUpgradeCost(playerId)) {
        // Bots roll a rarity too, so they get the same luck (and the same count rule) as a player
        const rarity = rollRarity();
        const option = rollOptions(hero, 1, [], rarity)[0];
        if (option === undefined) return;
        const size = spendForUpgrade(playerId);
        if (size === undefined) return;
        applyUpgrade(hero, option, rarityMultiplier(rarity), size);
    }
}

// Kills in a row of each hero, since its last death (for the bonus on killing a hero that is on a streak)
const streaks: Record<number, number> = {};

function giveTeam(team: DotaTeam, amount: number, reason: string) {
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (PlayerResource.IsValidPlayerID(playerId) && PlayerResource.GetTeam(playerId) === team) {
            addPoints(playerId, amount, reason);
        }
    }
}

/** 1-4 from a tower's unit name such as "npc_dota_goodguys_tower2_mid"; 0 if it has none. */
function towerTier(name: string): number {
    const [, , tier] = string.find(name, "tower(%d)");
    return tonumber(tier) ?? 0;
}

function onEntityKilled(event: EntityKilledEvent) {
    const killed = EntIndexToHScript(event.entindex_killed);
    const attacker = EntIndexToHScript(event.entindex_attacker ?? -1);
    if (killed === undefined || !killed.IsBaseNPC() || killed.IsIllusion()) return;
    const name = killed.GetUnitName();

    // Hero deaths end that hero's streak (whoever killed it)
    const killedId = killed.IsRealHero() ? killed.GetPlayerOwnerID() : -1;
    const victimStreak = killedId >= 0 ? streaks[killedId] ?? 0 : 0;
    if (killedId >= 0) streaks[killedId] = 0;

    if (attacker === undefined || !attacker.IsBaseNPC()) return;
    // Denies earn nothing
    if (killed.GetTeamNumber() === attacker.GetTeamNumber()) return;
    const team = attacker.GetTeamNumber();

    // Team rewards: every player of the team gets them, even if a creep took the last hit
    if (killed.IsTower()) {
        const reward = PointsSettings.perTowerTier[towerTier(name)] ?? 0;
        if (reward > 0) giveTeam(team, reward, `tier ${towerTier(name)} tower`);
        return;
    }
    if (name === "npc_dota_roshan") return giveTeam(team, PointsSettings.perRoshan, "roshan");

    const playerId = attacker.GetPlayerOwnerID();
    if (playerId < 0) return;

    if (killed.IsRealHero()) {
        const streakKills = victimStreak >= PointsSettings.streakBonusFrom ? victimStreak : 0;
        const bonus = math.min(streakKills * PointsSettings.perStreakKill, PointsSettings.maxStreakBonus);
        addPoints(playerId, PointsSettings.perHeroKill + bonus, bonus > 0 ? `hero kill (streak ${victimStreak})` : "hero kill");
        streaks[playerId] = (streaks[playerId] ?? 0) + 1;
    } else if (name === "npc_dota_observer_wards" || name === "npc_dota_sentry_wards") {
        // Checked before buildings, in case the engine counts wards as buildings. Only observers give points (user
        // 2026-09-29); sentries are still caught here so they don't count as some other kill.
        if (name === "npc_dota_observer_wards") addPoints(playerId, PointsSettings.perObserverDewarded, "deward");
    } else if (killed.IsBuilding()) {
        if (name.includes("rax")) addPoints(playerId, PointsSettings.perBarracks, "barracks");
    } else if (killed.GetTeamNumber() === DotaTeam.NEUTRALS) {
        addPoints(playerId, PointsSettings.perNeutral, "neutral");
    } else if (killed.IsCreep() && !killed.IsSummoned()) {
        addPoints(playerId, PointsSettings.perLaneCreep, "creep");
    }
}

/** Where each team's Ancient stands, for how deep a ward was placed. */
function ancientOf(team: DotaTeam): Vector | undefined {
    for (const fort of Entities.FindAllByClassname("npc_dota_fort")) {
        if (fort.GetTeamNumber() === team) return fort.GetAbsOrigin();
    }
    return undefined;
}

/** An observer ward was placed: more points the closer it is to the enemy Ancient. */
function onNpcSpawned(event: NpcSpawnedEvent) {
    const unit = EntIndexToHScript(event.entindex) as CDOTA_BaseNPC | undefined;
    if (unit === undefined) return;
    const name = unit.GetUnitName();
    // Debug: any other ward-like unit, in case the observer ward's unit name changed
    if (name.includes("ward") && name !== "npc_dota_observer_wards" && name !== "npc_dota_sentry_wards") print(`[points] ward-like unit spawned: ${name}`);
    if (name !== "npc_dota_observer_wards") return;
    // The ward has no owner yet in the spawn event (no points were paid, user 2026-09-30): read it a moment later
    Timers.CreateTimer(0.1, () => payObserverWard(unit));
}

function payObserverWard(unit: CDOTA_BaseNPC) {
    if (unit.IsNull()) return;
    let playerId = unit.GetPlayerOwnerID();
    const owner = unit.GetOwner() as CDOTA_BaseNPC | undefined;
    if (playerId < 0 && owner !== undefined && owner.IsBaseNPC?.()) playerId = owner.GetPlayerOwnerID();
    print(`[points] observer ward placed by player ${playerId}`);
    const team = unit.GetTeamNumber();
    if (playerId < 0) return;

    const own = ancientOf(team);
    const enemy = ancientOf(team === DotaTeam.GOODGUYS ? DotaTeam.BADGUYS : DotaTeam.GOODGUYS);
    let depth = 0.5;
    if (own !== undefined && enemy !== undefined) {
        const position = unit.GetAbsOrigin();
        const fromOwn = ((position - own) as Vector).Length2D();
        const fromEnemy = ((position - enemy) as Vector).Length2D();
        depth = fromOwn / math.max(fromOwn + fromEnemy, 1); // 0 at your own base, 1 at the enemy base
    }
    const { perObserverPlacedMin: low, perObserverPlacedMax: high } = PointsSettings;
    addPoints(playerId, math.floor(low + (high - low) * depth), "observer ward");
}

function onRune(event: DotaRuneActivatedServerEvent) {
    const rune = event.rune as RuneType;
    let reward = PointsSettings.perPowerRune;
    if (rune === RuneType.BOUNTY) reward = PointsSettings.perBountyRune;
    else if (rune === RuneType.WATER) reward = PointsSettings.perWaterRune;
    else if (rune === RuneType.XP) reward = PointsSettings.perWisdomRune;
    addPoints(event.PlayerID, reward, "rune");
}

// Lotus item entity index -> already paid
const paidLotuses: Record<number, boolean> = {};

export function registerPointsEvents() {
    ListenToGameEvent("entity_killed", event => onEntityKilled(event), undefined);
    ListenToGameEvent("npc_spawned", event => onNpcSpawned(event), undefined);
    ListenToGameEvent("dota_rune_activated_server", event => onRune(event), undefined);
    ListenToGameEvent("dota_player_used_ability", event => onAbilityUsed(event), undefined);
    // Lotus Pool lotuses are "item_famango" (Healing Lotus) and its bigger versions. Pool pickups go straight into the
    // inventory, so this listens for any item arriving in one; each lotus pays once, even when moved to the stash and back.
    ListenToGameEvent(
        "dota_inventory_item_added",
        event => {
            // Only the Healing Lotus a pool gives: combining two makes a recipe and a Great Healing Lotus, which are
            // new items and would pay again
            const name = event.itemname;
            if (name !== "item_famango") return;
            if (paidLotuses[event.item_entindex]) return;
            paidLotuses[event.item_entindex] = true;
            print(`[points] lotus picked up (${name}) by player ${event.inventory_player_id}`);
            addPoints(event.inventory_player_id, PointsSettings.perLotus, "lotus");
        },
        undefined,
    );
}

// Watchers ("lamps" in the game files) are captured with a generic skill every hero has. Nothing the scripts can read
// changes when a capture completes (checked 2026-09-30: the hero never reports channelling, the watcher keeps team 5
// and the same modifiers), and dota_watch_tower_captured no longer fires. The skill fires when the capture STARTS, and
// paying there could be abused (user 2026-09-30). So a capture counts as done when the hero stays on the spot, alive
// and not disabled, for the skill's whole channel time (moving or a stun cancels it in Dota too). And a team is paid
// for a watcher only once until the other team captures it.
const captureSkills = ["ability_lamp_use", "ability_capture"];
/** How far the hero may drift while capturing (units) */
const CAPTURE_DRIFT = 40;
// playerId -> a capture is being watched (both skill names may fire for one capture)
const watchingCapture: Record<number, boolean> = {};
// watcher entindex -> team that captured it last
const watcherOwner: Record<number, DotaTeam> = {};

/** The watcher (npc_dota_lantern) nearest to a position, within capture range. */
function nearestWatcher(position: Vector): CDOTA_BaseNPC | undefined {
    let best: CDOTA_BaseNPC | undefined;
    let bestDistance = 600;
    for (const unit of Entities.FindAllByClassnameWithin("npc_dota_lantern", position, 600) as CDOTA_BaseNPC[]) {
        const distance = ((unit.GetAbsOrigin() - position) as Vector).Length2D();
        if (distance < bestDistance) [best, bestDistance] = [unit, distance];
    }
    return best;
}

/** Whether the hero can keep capturing: alive, not moved away, not stunned, hexed, silenced or taunted. */
function stillCapturing(hero: CDOTA_BaseNPC, spot: Vector): boolean {
    if (!hero.IsAlive() || hero.IsStunned() || hero.IsHexed() || hero.IsSilenced() || hero.IsCommandRestricted()) return false;
    return ((hero.GetAbsOrigin() - spot) as Vector).Length2D() <= CAPTURE_DRIFT;
}

function onAbilityUsed(event: DotaPlayerUsedAbilityEvent) {
    if (!captureSkills.includes(event.abilityname)) return;
    const playerId = event.PlayerID;
    if (!PlayerResource.IsValidPlayerID(playerId) || watchingCapture[playerId]) return;
    const hero = PlayerResource.GetSelectedHeroEntity(playerId);
    const watcher = hero && nearestWatcher(hero.GetAbsOrigin());
    if (hero === undefined || watcher === undefined) return;
    const ability = hero.FindAbilityByName(event.abilityname);
    const channelTime = math.max(ability?.GetChannelTime() ?? 1, 0.5);
    const team = hero.GetTeamNumber();
    const watcherId = watcher.entindex();

    watchingCapture[playerId] = true;
    const spot = hero.GetAbsOrigin();
    const started = GameRules.GetGameTime();
    Timers.CreateTimer(0.1, () => {
        const lasted = GameRules.GetGameTime() - started;
        if (!stillCapturing(hero, spot)) {
            watchingCapture[playerId] = false;
            print(`[points] watcher capture cancelled after ${string.format("%.1f", lasted)} of ${channelTime} s: no honey`);
            return;
        }
        if (lasted < channelTime) return 0.1;
        watchingCapture[playerId] = false;
        if (watcherOwner[watcherId] === team) {
            print(`[points] watcher ${watcherId} already belongs to team ${team}: no honey`);
            return;
        }
        watcherOwner[watcherId] = team;
        print(`[points] watcher ${watcherId} captured by team ${team} (player ${playerId})`);
        giveTeam(team, PointsSettings.perWatcherCapture, "watcher");
    });
}

/** Gives every player enough points for their first `startingUpgrades` modifications (not affected by the points multiplier). */
export function giveStartingUpgrades() {
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (!PlayerResource.IsValidPlayerID(playerId)) continue;

        const done = stateOf(playerId).upgrades;
        let total = 0;
        for (let i = 0; i < config.startingUpgrades; i++) total += costOf(done + i);
        addPoints(playerId, total, "debug");
    }
}

const PASSIVE_TICK_SECONDS = 5;

/**
 * Gives every player their "points per minute". Called every second by the game tick once the horn has sounded,
 * but pays only every few seconds, so the points net table is not rewritten every second.
 */
export function payPassivePoints(seconds: number) {
    if (seconds % PASSIVE_TICK_SECONDS !== 0) return;
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (PlayerResource.IsValidPlayerID(playerId)) {
            addPoints(playerId, (config.pointsPerMinute * PASSIVE_TICK_SECONDS) / 60, "time");
        }
    }
}

/** Size of the next buff the player can already afford, or undefined while they cannot afford one. */
export function affordableSize(playerId: PlayerID): number | undefined {
    return stateOf(playerId).sizes[0];
}
