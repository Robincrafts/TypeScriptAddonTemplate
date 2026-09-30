import { reloadable } from "./lib/tstl-utils";
import { modifier_boost } from "./modifiers/modifier_boost";
import { registerBoostCommands } from "./boost/boost_commands";
import { config } from "./boost/config";
import { giveStartingUpgrades } from "./boost/points";
import { applyUniversalShop, registerDeadPurchases, registerSellAnywhere, tickEarlyShard } from "./boost/shop";
import { showTips } from "./boost/tips";
import { applyTowerSettings, registerTowerDamage, updateTowerGrowth } from "./boost/towers";
import { checkGameEnd } from "./boost/game_end";
import { registerLobbySettings } from "./boost/lobby_settings";
import { checkCostStep, payPassivePoints, registerPointsEvents } from "./boost/points";
import { refreshChangedMenus, registerUpgradeUi } from "./boost/upgrade_ui";
import { refreshBuffSummaries } from "./boost/buff_summary";
import { randomUnpicked, registerPickMode, startPickMode } from "./boost/pick_modes";
import { GameSettings, incomeGoldReasons } from "./game_settings";

declare global {
    interface CDOTAGameRules {
        Addon: GameMode;
    }
}

/** The host's gold multiplier for one source of gold (1 for sources that are not income, like selling items). */
function goldMultiplierFor(reason: ModifyGoldReason): number {
    if (reason === ModifyGoldReason.CREEP_KILL) return config.creepGoldMultiplier;
    if (reason === ModifyGoldReason.NEUTRAL_KILL) return config.neutralGoldMultiplier;
    if (reason === ModifyGoldReason.HERO_KILL) return config.heroGoldMultiplier;
    return incomeGoldReasons.includes(reason) ? config.goldMultiplier : 1;
}

// Tools mode: each gold source is printed once, to check that neutral and lane creep gold really arrive as
// different reasons (confirmed 2026-09-29: lane 13, neutral 14).
const loggedGoldReasons: Record<number, boolean> = {};
function logGoldReason(reason: ModifyGoldReason, gold: number, multiplier: number) {
    if (!IsInToolsMode() || loggedGoldReasons[reason]) return;
    loggedGoldReasons[reason] = true;
    print(`[gold] first gold of reason ${reason}: ${gold} x ${multiplier}`);
}

@reloadable
export class GameMode {
    public static Precache(this: void, context: CScriptPrecacheContext) {
        // Precache custom resources here
    }

    public static Activate(this: void) {
        // When the addon activates, create a new instance of this GameMode class.
        GameRules.Addon = new GameMode();
    }

    constructor() {
        this.configure();
        registerLobbySettings();
        registerBoostCommands();
        registerPointsEvents();
        registerUpgradeUi();

        // Register event listeners for dota engine events
        ListenToGameEvent("game_rules_state_change", () => this.OnStateChange(), undefined);
        ListenToGameEvent("npc_spawned", event => this.OnNpcSpawned(event), undefined);
        ListenToGameEvent("entity_killed", event => this.onEntityKilled(event), undefined);
    }

    private startingGoldGiven: Record<number, boolean> = {};

    private configure(): void {
        GameRules.SetCustomGameTeamMaxPlayers(DotaTeam.GOODGUYS, GameSettings.teamSize);
        GameRules.SetCustomGameTeamMaxPlayers(DotaTeam.BADGUYS, GameSettings.teamSize);

        // Phases. The setup screen (our settings menu) waits until the host starts the game.
        GameRules.SetCustomGameSetupTimeout(-1);
        GameRules.SetShowcaseTime(0);
        GameRules.SetStrategyTime(GameSettings.strategyTime);
        GameRules.SetHeroSelectionTime(GameSettings.heroSelectionTime);
        // F1: the Random button greyed out with 10 s left, when Dota's default penalty time starts. Without penalty time
        // players can random until the timer ends; late picking costs no gold either
        GameRules.SetHeroSelectPenaltyTime(0);
        GameRules.GetGameModeEntity().SetSelectionGoldPenaltyEnabled(false);
        GameRules.SetPreGameTime(config.preGameTime);
        GameRules.SetPostGameTime(GameSettings.postGameTime);

        // The engine's own gold tick is unreliable in custom games, so passive gold is paid by
        // payPassiveGold() below and the engine tick is turned off to avoid paying twice.
        GameRules.SetGoldPerTick(0);

        // Universal shop may need to be set before the shops are set up, so set it here with the default too
        applyUniversalShop();

        // These read the settings each time, so the host's menu choices apply without a restart
        const mode = GameRules.GetGameModeEntity();
        mode.SetModifyGoldFilter(event => {
            if (event.gold > 0) {
                const multiplier = goldMultiplierFor(event.reason_const);
                logGoldReason(event.reason_const, event.gold, multiplier);
                event.gold = math.floor(event.gold * multiplier);
            }
            return true;
        }, {});
        mode.SetModifyExperienceFilter(event => {
            event.experience = math.floor(event.experience * config.xpMultiplier);
            return true;
        }, {});

        // Standard Dota features that custom games start without
        mode.SetFreeCourierModeEnabled(true); // every player gets a courier
        registerSellAnywhere(mode); // "Mark for Sell" sells right away, from anywhere
        registerPickMode(); // the lobby's map decides All Pick / Single Draft / All Random
        registerTowerDamage(mode); // tower attacks grow stronger over the game
        registerDeadPurchases(); // items bought while dead go to the hero, not the courier
        mode.SetUseDefaultDOTARuneSpawnLogic(true); // bounty and power runes
        mode.SetAllowNeutralItemDrops(true);
        mode.SetNeutralStashEnabled(true);
        mode.SetTowerBackdoorProtectionEnabled(true);
    }

    /** Rules the engine wants set as values (not as callbacks). Called again when the host's choices are final. */
    private applyRules(): void {
        GameRules.SetStartingGold(config.startingGold);
        // The host may have changed the countdown in the setup menu; set before the pre-game starts
        GameRules.SetPreGameTime(config.preGameTime);
        applyUniversalShop();
        // Dota's own level-based respawn time, scaled (0.75 = Turbo); a fixed time overrides it. -1 = no fixed time
        GameRules.GetGameModeEntity().SetRespawnTimeScale(config.respawnScale);
        GameRules.GetGameModeEntity().SetFixedRespawnTime(config.fixedRespawnTime > 0 ? config.fixedRespawnTime : -1);
        // Turbo couriers fly from the start; set before the couriers spawn with the heroes
        GameRules.GetGameModeEntity().SetUseTurboCouriers(config.flyingCourier === 1);
    }

    public OnStateChange(): void {
        const state = GameRules.State_Get();

        // Fill both teams with bots in tools: one seat is yours, so Radiant gets one bot less
        if (IsInToolsMode() && state == GameState.CUSTOM_GAME_SETUP) {
            const heroes = GameSettings.testBotHeroes;
            for (let i = 0; i < GameSettings.teamSize - 1; i++) {
                Tutorial.AddBot(heroes[i % heroes.length], "", "", true);
            }
            for (let i = 0; i < GameSettings.teamSize; i++) {
                Tutorial.AddBot(heroes[(i + GameSettings.teamSize - 1) % heroes.length], "", "", false);
            }
        }

        if (state === GameState.HERO_SELECTION) {
            this.applyRules();
            startPickMode(GameSettings.heroSelectionTime); // All Random / Single Draft, from the map (pick_modes.ts)
        }

        // Hero selection is over: anyone still without a hero gets a random one
        if (state === GameState.STRATEGY_TIME) randomUnpicked();

        // Start game once pregame hits
        if (state === GameState.PRE_GAME) {
            this.applyRules();
            applyTowerSettings();
            this.applyCourierSpeed();
            Timers.CreateTimer(1, () => {
                giveStartingUpgrades();
            });
            showTips();
            // Last chance for a player who still has not picked (only a random pick: never create a hero here)
            randomUnpicked();
            this.startTick();
            Timers.CreateTimer(0.2, () => this.StartGame());
        }
    }

    /**
     * The one repeating timer of the game mode, from the pre-game until the game ends. Everything that runs
     * regularly hangs off it instead of keeping its own timer.
     */
    private startTick(): void {
        let seconds = 0;
        Timers.CreateTimer(1, () => {
            const state = GameRules.State_Get();
            if (state >= GameState.POST_GAME) return;
            seconds++;

            refreshChangedMenus();
            refreshBuffSummaries();
            tickEarlyShard();
            updateTowerGrowth();
            for (const hero of HeroList.GetAllHeroes()) modifier_boost.updateGrowth(hero);

            if (state === GameState.GAME_IN_PROGRESS) {
                this.payPassiveGold();
                payPassivePoints(seconds);
                checkCostStep();
                checkGameEnd();
            }
            return 1;
        });
    }

    // playerId (as string) -> fraction of a gold not paid yet
    private goldCarry: Record<string, number> = {};

    /** Passive gold for every hero, once a second after the horn. Fractions of a gold are carried over. */
    private payPassiveGold(): void {
        for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
            if (!PlayerResource.IsValidPlayerID(playerId)) continue;

            const hero = PlayerResource.GetSelectedHeroEntity(playerId);
            if (hero === undefined) continue;

            const key = tostring(playerId);
            const total = (this.goldCarry[key] ?? 0) + config.goldPerMinute / 60;
            const whole = math.floor(total);
            this.goldCarry[key] = total - whole;
            if (whole > 0) hero.ModifyGold(whole, true, ModifyGoldReason.GAME_TICK);
        }
    }


    /** Couriers that already exist when the game starts (later ones are handled when they spawn). */
    private applyCourierSpeed(): void {
        for (const entity of Entities.FindAllByClassname("npc_dota_courier")) {
            this.setCourierSpeed(entity as CDOTA_BaseNPC);
        }
    }

    private setCourierSpeed(courier: CDOTA_BaseNPC): void {
        if (config.courierSpeedMultiplier !== 1) {
            courier.SetBaseMoveSpeed(courier.GetBaseMoveSpeed() * config.courierSpeedMultiplier);
        }
    }

    private StartGame(): void {
        print("Game starting!");
        GameRules.SendCustomMessage("Welcome to <font color='#FFD700'>Honey, I Buffed the Heroes</font>!", 0, 0);
    }

    // Called on script_reload
    public Reload() {
        print("Script reloaded!");

        // Do some stuff here
    }

    private OnNpcSpawned(event: NpcSpawnedEvent) {
        const unit = EntIndexToHScript(event.entindex) as CDOTA_BaseNPC | undefined; // Cast to npc since this is the 'npc_spawned' event
        // Already gone (boost_audit spawns a hero and removes it at once)
        if (unit === undefined) return;
        // Every real hero (not illusions) gets the modifier that applies its ability boosts
        if (unit.IsRealHero() && !unit.HasModifier(modifier_boost.name)) {
            modifier_boost.apply(unit, unit);
            // Clients never load modifier_boost by themselves; this plain-Lua modifier makes them (see its file)
            LinkLuaModifier("modifier_boost_loader", "modifiers/modifier_boost_loader", LuaModifierMotionType.NONE);
            unit.AddNewModifier(unit, undefined, "modifier_boost_loader", {});
        }

        // The engine starting gold setting is not reliable here, so set it once per hero ourselves
        if (unit.IsRealHero() && !unit.IsIllusion() && GameRules.State_Get() >= GameState.HERO_SELECTION) {
            const playerId = unit.GetPlayerOwnerID();
            if (playerId >= 0 && !this.startingGoldGiven[playerId]) {
                this.startingGoldGiven[playerId] = true;
                unit.SetGold(config.startingGold, true);
                unit.SetGold(0, false);
            }
        }

        // A courier that spawns after the game started (respawn, new player) is sped up as well
        if (unit.IsCourier() && GameRules.State_Get() >= GameState.PRE_GAME) {
            this.setCourierSpeed(unit);
        }
    }

    /**
     * Adjusts each hero death's respawn time: with random respawn on it rolls its own time (the spread grows as the
     * game goes on), and it never goes above the host's maximum respawn time.
     */
    private onEntityKilled(event: EntityKilledEvent) {
        const random = config.randomRespawn === 1;
        if (!random && config.maxRespawnTime <= 0) return;

        const killed = EntIndexToHScript(event.entindex_killed);
        if (killed === undefined || !killed.IsBaseNPC() || !killed.IsRealHero() || killed.IsIllusion()) return;

        const minutes = GameRules.GetDOTATime(false, false) / 60;
        const spread = math.min(0.1 + minutes * 0.02, 0.6); // +-10% at the start, +-60% after 25 minutes
        const roll = random ? RandomFloat(1 - spread, 1 + spread) : 1;
        // The engine sets its own timer (level-based, scaled) at the moment of death, so change it a moment later
        Timers.CreateTimer(0.05, () => {
            const hero = killed as CDOTA_BaseNPC_Hero;
            const normal = hero.GetRespawnTime();
            let time = normal * roll;
            if (config.maxRespawnTime > 0) time = math.min(time, config.maxRespawnTime);
            if (time !== normal) hero.SetTimeUntilRespawn(math.max(time, 1));
        });
    }
}
