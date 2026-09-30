// Console commands for testing boosts in game (open the console with ~).
// They apply to the hero of the player who typed the command.
import { getHeroBoosts, setBoostField, setBoostValue, SimpleBoostField } from "./boost_store";
import {
    applyUpgrade,
    changePower,
    describeLimits,
    getAbilityOptions,
    goodDelta,
    invokerScepterOption,
    maxOut,
    rarityMultiplier,
    resetUpgrades,
    rollOptions,
    rollRarity,
    skipReason,
} from "./upgrade_engine";
import { addPoints, getPointRate, getPoints, setPointRate, spendForUpgrade } from "./points";
import { refreshMenu } from "./upgrade_ui";

// The options shown by the last boost_roll, waiting for boost_pick
let pendingRoll: UpgradeOption[] = [];

function describe(option: UpgradeOption): string {
    const arrow = option.direction === "up" ? "↑" : "↓";
    return `${option.ability}: ${option.label} ${arrow} (base ${option.base})`;
}

function commandHero(): CDOTA_BaseNPC_Hero | undefined {
    // In tools mode the command client is not always a real player object, so use it only when it works
    const player = Convars.GetDOTACommandClient() as any;
    if (player !== undefined && typeof player.GetPlayerID === "function") {
        return PlayerResource.GetSelectedHeroEntity(player.GetPlayerID());
    }

    // Otherwise take the first human player (bots are fake clients)
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (PlayerResource.IsValidPlayerID(playerId) && !PlayerResource.IsFakeClient(playerId)) {
            const hero = PlayerResource.GetSelectedHeroEntity(playerId);
            if (hero !== undefined) return hero;
        }
    }
}

// Dota's Lua has no JSON library, so print tables ourselves
function dump(value: unknown): string {
    if (typeof value !== "object" || value === undefined) return tostring(value);
    const parts: string[] = [];
    for (const [k, v] of pairs(value as any)) {
        parts.push(`${tostring(k)}=${dump(v)}`);
    }
    return `{${parts.join(", ")}}`;
}

// Commands that only print information: they change nothing, so they work in every match
const readOnlyCommands = ["boost_status", "boost_show", "boost_audit", "boost_options", "boost_list", "boost_points", "boost_valueinfo"];

/**
 * Registers a test command that only works in tools mode (testing on your own PC). In any real match,
 * including lobbies with cheats on, they do nothing, so no player can give themselves points, gold or boosts.
 * The read-only commands above are the exception.
 */
function registerCommand(name: string, run: (name: string, ...args: string[]) => void, help: string, flags: number) {
    Convars.RegisterCommand(
        name,
        (commandName: string, ...args: string[]) => {
            if (!IsInToolsMode() && !readOnlyCommands.includes(name)) {
                print(`${name} only works in tools mode.`);
                return;
            }
            run(commandName, ...args);
        },
        help,
        flags,
    );
}

function say(message: string) {
    print(`[boost] ${message}`);
    GameRules.SendCustomMessage(`[boost] ${message}`, 0, 0);
}

/** Prints every stat of a hero's skills that the BUFF panel can offer, with its base value and cap. */
/**
 * The audit of one hero as text lines: every skill with the stats the BUFF panel can offer (base value, good
 * direction, cap), and skipped skills with the reason. With `assumeItems`, Scepter/Shard stats are listed too.
 */
function auditLines(hero: CDOTA_BaseNPC, assumeItems = false, valueKeys?: string[]): string[] {
    const lines: string[] = [];
    let total = 0;
    for (let i = 0; i < hero.GetAbilityCount(); i++) {
        const ability = hero.GetAbilityByIndex(i);
        if (ability === undefined) continue;
        const reason = skipReason(ability);
        // For the full audit, hidden skills that are real (Scepter/Shard skills, Invoker's spells) are listed too:
        // in a match they become visible once owned or invoked. Empty slots and generic placeholders stay skipped.
        const name = ability.GetAbilityName();
        const hiddenButReal = assumeItems && reason === "hidden" && name !== "generic_hidden" && !name.includes("_empty");
        if (reason !== undefined && !hiddenButReal) {
            if (reason !== "talent") lines.push(`  ${name}: skipped (${reason})`);
            continue;
        }
        const options = getAbilityOptions(ability, assumeItems);
        const passive = (ability.IsPassive() ? " (passive)" : "") + (hiddenButReal ? " (hidden)" : "");
        if (options.length === 0) {
            lines.push(`  ${ability.GetAbilityName()}${passive}: nothing`);
            continue;
        }
        lines.push(`  ${ability.GetAbilityName()}${passive}:`);
        for (const option of options) {
            const key = option.valueName ?? option.kind;
            if (option.kind === "value") valueKeys?.push(`${option.ability}|${option.valueName}`);
            lines.push(`    ${option.label} [${key}] (base ${option.base}, better ${option.direction}; ${describeLimits(option)})`);
        }
        total += options.length;
    }
    lines.push(`  ${total} stats in total`);
    return lines;
}

function auditHero(hero: CDOTA_BaseNPC) {
    say(`Modifiable stats of ${hero.GetUnitName()}:`);
    for (const line of auditLines(hero)) print(line);
}

/** Every hero in Dota, from the game's hero list (without the base and test entries). */
function allHeroNames(): string[] {
    const kv = LoadKeyValues("scripts/npc/npc_heroes.txt") as any;
    const heroes = kv?.DOTAHeroes ?? kv ?? {};
    const names: string[] = [];
    for (const name in heroes) {
        if (!name.startsWith("npc_dota_hero_") || name === "npc_dota_hero_base" || name.includes("target_dummy")) continue;
        names.push(name);
    }
    table.sort(names);
    return names;
}

function withAbility(abilityName: string | undefined, run: (hero: CDOTA_BaseNPC_Hero, ability: CDOTABaseAbility) => void) {
    const hero = commandHero();
    if (hero === undefined) return say("No hero found for you yet.");
    if (abilityName === undefined) return say("Missing ability name, e.g. lina_light_strike_array");

    const ability = hero.FindAbilityByName(abilityName);
    if (ability === undefined) return say(`Your hero has no ability '${abilityName}'. Try boost_show.`);
    run(hero, ability);
}

function simpleCommand(command: string, field: SimpleBoostField, help: string) {
    registerCommand(
        command,
        (_, abilityName, amount) => {
            const value = tonumber(amount);
            if (value === undefined) return say(`Usage: ${command} <ability> <number>`);
            withAbility(abilityName, (hero, ability) => {
                setBoostField(hero, ability.GetAbilityName(), field, value);
                say(`${ability.GetAbilityName()}: ${field} = ${value}`);
            });
        },
        help,
        0,
    );
}

export function registerBoostCommands() {
    registerCommand(
        "boost_givegold",
        (_, amount) => {
            const value = tonumber(amount);
            if (value === undefined) return say("Usage: boost_givegold <amount>");
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            PlayerResource.ModifyGold(hero.GetPlayerOwnerID(), value, true, ModifyGoldReason.UNSPECIFIED);
            say(`+${value} gold`);
        },
        "boost_givegold <amount>  (gives your hero gold)",
        0,
    );

    registerCommand(
        "boost_kill",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            hero.Kill(undefined, hero);
            say(`Killed ${hero.GetUnitName()} (level ${hero.GetLevel()}).`);
        },
        "boost_kill  (kills your hero, to test respawn times)",
        0,
    );

    registerCommand(
        "boost_herokill",
        (_, who, count) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            if (who !== "me" && who !== "enemy") return say("Usage: boost_herokill <me|enemy> [count]");
            let enemy: CDOTA_BaseNPC_Hero | undefined;
            for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS && enemy === undefined; playerId++) {
                if (!PlayerResource.IsValidPlayerID(playerId) || PlayerResource.GetTeam(playerId) === hero.GetTeamNumber()) continue;
                enemy = PlayerResource.GetSelectedHeroEntity(playerId);
            }
            if (enemy === undefined) return say("No enemy hero found.");
            // Real kills with a killer, so the scoreboard, kill gold, streaks and points all count them
            const [killer, victim] = who === "me" ? [hero, enemy] : [enemy, hero];
            const times = math.max(1, tonumber(count) ?? 1);
            for (let i = 0; i < times; i++) {
                if (!victim.IsAlive()) victim.RespawnHero(false, false);
                victim.Kill(undefined, killer);
            }
            say(`${killer.GetUnitName()} killed ${victim.GetUnitName()} ${times} time(s).`);
        },
        "boost_herokill <me|enemy> [count]  (me: you kill the first enemy hero; enemy: it kills you. Real kills, e.g. to test the kill limit)",
        0,
    );

    simpleCommand("boost_cooldown", "cooldown", "boost_cooldown <ability> <multiplier>  (0.5 = half the cooldown)");
    simpleCommand("boost_casttime", "casttime", "boost_casttime <ability> <multiplier>  (0.5 = half the cast point)");
    simpleCommand("boost_mana", "manacost", "boost_mana <ability> <multiplier>  (0.5 = half the mana cost)");
    simpleCommand("boost_range", "castrange", "boost_range <ability> <bonus>  (flat cast range bonus)");

    registerCommand(
        "boost_value",
        (_, abilityName, valueName, amount) => {
            const multiplier = tonumber(amount);
            if (valueName === undefined || multiplier === undefined) {
                return say("Usage: boost_value <ability> <value name> <multiplier>  (see boost_list)");
            }
            withAbility(abilityName, (hero, ability) => {
                setBoostValue(hero, ability.GetAbilityName(), valueName, multiplier);
                say(`${ability.GetAbilityName()}: ${valueName} x${multiplier}`);
            });
        },
        "boost_value <ability> <value name> <multiplier>",
        0,
    );

    registerCommand(
        "boost_reset",
        (_, abilityName) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            resetUpgrades(hero, abilityName);
            say(abilityName === undefined ? "All boosts cleared." : `Boosts of ${abilityName} cleared.`);
        },
        "boost_reset [ability]  (no argument clears everything)",
        0,
    );

    // Lists the ability value names that can be used with boost_value
    registerCommand(
        "boost_list",
        (_, abilityName) => {
            withAbility(abilityName, (_, ability) => {
                const keyValues = ability.GetAbilityKeyValues() as any;
                say(`Values of ${ability.GetAbilityName()}:`);
                for (const valueName in keyValues.AbilityValues ?? {}) {
                    print(`  ${valueName} = ${dump(keyValues.AbilityValues[valueName])}`);
                }
                for (const legacy of ["AbilityCooldown", "AbilityCastPoint", "AbilityCastRange", "AbilityManaCost"]) {
                    if (keyValues[legacy] !== undefined) print(`  ${legacy} = ${keyValues[legacy]}`);
                }
            });
        },
        "boost_list <ability>  (prints value names to the console)",
        0,
    );

    // Shows how Dota computes one ability value (base, item/talent bonus, our override), for Shard/Scepter values
    registerCommand(
        "boost_valueinfo",
        (_, abilityName, valueName) => {
            if (valueName === undefined) return say("Usage: boost_valueinfo <ability> <value name>  (see boost_list)");
            withAbility(abilityName, (hero, ability) => {
                const level = ability.GetLevel();
                const keyValues = ability.GetAbilityKeyValues() as any;
                say(`${ability.GetAbilityName()} ${valueName}, ability level ${level}:`);
                print(`  KV entry: ${dump(keyValues.AbilityValues?.[valueName])}`);
                print(`  NoOverride(level-1 = ${level - 1}): ${ability.GetLevelSpecialValueNoOverride(valueName, level - 1)}`);
                print(`  NoOverride(level = ${level}): ${ability.GetLevelSpecialValueNoOverride(valueName, level)}`);
                print(`  GetSpecialValueFor (what the game uses): ${ability.GetSpecialValueFor(valueName)}`);
                print(`  Our buff multiplier: ${getHeroBoosts(hero)?.[ability.GetAbilityName()]?.values?.[valueName] ?? "none"}`);
                print(`  Our added amount: ${getHeroBoosts(hero)?.[ability.GetAbilityName()]?.adds?.[valueName] ?? "none"}`);
                print(`  Has Scepter: ${hero.HasScepter()}, has Shard: ${hero.HasModifier("modifier_item_aghanims_shard")}`);
            });
        },
        "boost_valueinfo <ability> <value name>  (how Dota computes one ability value)",
        0,
    );

    // Audits EVERY hero in Dota, for the balance pass. Lua's io is missing even in tools mode, so every line is
    // printed with an [audit] tag; npm run launch starts Dota with -condebug, which saves the console to game/dota/console.log
    registerCommand(
        "boost_audit_every",
        () => {
            const names = allHeroNames();
            if (names.length === 0) return say("Could not read the hero list.");
            say(`Auditing ${names.length} heroes, one every 0.1 s (about ${math.ceil(names.length / 10)} s)...`);
            // Your UI prints Dota's tooltip label of every value too ([tooltip] lines, for scripts/gen_tooltips.js)
            const you = commandHero();
            const player = you === undefined ? undefined : PlayerResource.GetPlayer(you.GetPlayerOwnerID());

            let index = 0;
            Timers.CreateTimer(0.1, () => {
                const name = names[index];
                const hero = CreateUnitByName(name, Vector(-7000, -7000, 0), false, undefined, undefined, DotaTeam.NEUTRALS);
                print(`[audit] ${name}`);
                if (hero === undefined) print("[audit]   could not create");
                else {
                    const valueKeys: string[] = [];
                    for (const line of auditLines(hero, true, valueKeys)) print(`[audit] ${line}`);
                    if (player !== undefined && valueKeys.length > 0) {
                        CustomGameEventManager.Send_ServerToPlayer(player, "boost_localize_request", { keys: valueKeys.join(";") });
                    }
                    UTIL_Remove(hero);
                }
                index++;
                if (index < names.length) return 0.1;
                say(`Done: ${names.length} heroes audited (lines tagged [audit]).`);
            });
        },
        "boost_audit_every  (tools mode: prints every hero's buffable stats, tagged [audit]; npm run launch saves the console to game/dota/console.log)",
        0,
    );

    // Lists every stat of a hero that can be modified, with how far it may go
    registerCommand(
        "boost_audit",
        (_, heroArg) => {
            if (heroArg === undefined) {
                const hero = commandHero();
                if (hero === undefined) return say("No hero found for you yet.");
                return auditHero(hero);
            }
            if (heroArg === "all") {
                for (const hero of HeroList.GetAllHeroes()) if (hero.IsRealHero()) auditHero(hero);
                return;
            }

            const heroName = heroArg.startsWith("npc_dota_hero_") ? heroArg : `npc_dota_hero_${heroArg}`;
            const inMatch = HeroList.GetAllHeroes().find(hero => hero.IsRealHero() && hero.GetUnitName() === heroName);
            if (inMatch !== undefined) return auditHero(inMatch);

            // Not in this match: spawn it out of sight for a moment, read its skills, remove it
            if (GetUnitKeyValuesByName(heroName) === undefined) return say(`Unknown hero '${heroArg}', e.g. pudge or npc_dota_hero_pudge`);
            const temp = CreateUnitByName(heroName, Vector(-7000, -7000, 0), false, undefined, undefined, DotaTeam.NEUTRALS);
            if (temp === undefined) return say(`Could not create ${heroName}.`);
            auditHero(temp);
            UTIL_Remove(temp);
        },
        "boost_audit [hero|all]  (every modifiable stat with its cap; your hero, any hero e.g. pudge, or all heroes in the match)",
        0,
    );

    registerCommand(
        "boost_show",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            say(`Abilities of ${hero.GetUnitName()}:`);
            for (let i = 0; i < hero.GetAbilityCount(); i++) {
                const ability = hero.GetAbilityByIndex(i);
                if (ability !== undefined) print(`  ${ability.GetAbilityName()} (level ${ability.GetLevel()})`);
            }
            print(`Active boosts: ${dump(getHeroBoosts(hero) ?? {})}`);
        },
        "boost_show  (lists your abilities and active boosts)",
        0,
    );

    // --- Testing helpers ---

    // Numbers to check the base game mode rules against game_settings.ts
    registerCommand(
        "boost_status",
        () => {
            const hero = commandHero();
            const time = GameRules.GetDOTATime(false, false);
            say(`Game time ${math.floor(time)} s`);
            print(`  Radiant players: ${PlayerResource.GetPlayerCountForTeam(DotaTeam.GOODGUYS)}`);
            print(`  Dire players: ${PlayerResource.GetPlayerCountForTeam(DotaTeam.BADGUYS)}`);
            if (hero !== undefined) {
                print(`  Your hero: ${hero.GetUnitName()}, level ${hero.GetLevel()}`);
                print(`  Your gold: ${PlayerResource.GetGold(hero.GetPlayerOwnerID())}`);
                print(`  Your respawn time: ${hero.GetRespawnTime()} s`);
            }
        },
        "boost_status  (team sizes, game time, your gold and level)",
        0,
    );

    // Levels up the hero; the skill points are left for you to spend
    registerCommand(
        "boost_level",
        (_, amount) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");

            const levels = tonumber(amount) ?? 1;
            for (let i = 0; i < levels; i++) hero.HeroLevelUp(false);
            say(`Hero is now level ${hero.GetLevel()}. Skill points to spend: ${hero.GetAbilityPoints()}`);
        },
        "boost_level <levels>  (levels up your hero, you spend the skill points)",
        0,
    );

    // Spends all remaining skill points automatically
    registerCommand(
        "boost_autoskill",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");

            // Spread points over the abilities round robin, so every spell gets trained
            let spent = true;
            while (hero.GetAbilityPoints() > 0 && spent) {
                spent = false;
                for (let i = 0; i < hero.GetAbilityCount() && hero.GetAbilityPoints() > 0; i++) {
                    const ability = hero.GetAbilityByIndex(i);
                    if (ability === undefined || ability.IsAttributeBonus() || !ability.CanAbilityBeUpgraded()) continue;
                    hero.UpgradeAbility(ability);
                    spent = true;
                }
            }
            say(`Skill points left: ${hero.GetAbilityPoints()}`);
        },
        "boost_autoskill  (spends all your skill points on your abilities)",
        0,
    );

    // Pushes a stat straight to its current limit (the "max now" number from boost_audit), in its good direction.
    // Bypasses the MODIFY panel and the normal one-click-at-a-time movement (counts otherwise move by exactly 1 per
    // click), so it costs nothing: useful to check a cap without clicking hundreds of times. The cap itself grows
    // with game time, so a stat maxed now can be pushed further again later.
    registerCommand(
        "boost_max",
        (_, abilityName, statKey) => {
            withAbility(abilityName, (hero, ability) => {
                const options = getAbilityOptions(ability);
                const targets = statKey === undefined ? options : options.filter(o => (o.valueName ?? o.kind) === statKey);
                if (targets.length === 0) {
                    return say(statKey === undefined
                        ? `${ability.GetAbilityName()} has nothing to max. Try boost_options.`
                        : `${ability.GetAbilityName()} has no stat '${statKey}'. Try boost_options.`);
                }
                const direction = (option: UpgradeOption) => (option.direction === "up" ? 1 : -1);
                for (const option of targets) maxOut(hero, option, direction(option));
                for (const option of targets) print(`  ${describe(option)} maxed`);
                refreshMenu(hero.GetPlayerOwnerID()); // the MODIFY panel would otherwise keep showing the old value/limit
                say(`Maxed ${targets.length} stat(s) of ${ability.GetAbilityName()} to their current limit (the cap grows over the game).`);
            });
        },
        "boost_max <ability> [value name]  (pushes one stat, or every stat, of an ability straight to its current cap)",
        0,
    );

    // Gives every bot hero free random buffs, to fill the everyone's-buffs view (G1) for testing: random rarities,
    // every third one the other way (a ▼ line), and with "max" one stat per bot pushed to its current cap (MAX badge;
    // the badge needs the FINAL cap, so it shows on stats whose cap is already fully open).
    registerCommand(
        "boost_botbuffs",
        (_, countText, maxText) => {
            const count = math.max(math.floor(tonumber(countText) ?? 5), 1);
            let bots = 0;
            for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
                if (!PlayerResource.IsValidPlayerID(playerId) || !PlayerResource.IsFakeClient(playerId)) continue;
                const hero = PlayerResource.GetSelectedHeroEntity(playerId);
                if (hero === undefined) continue;
                bots++;
                for (let i = 1; i <= count; i++) {
                    const rarity = rollRarity();
                    const option = rollOptions(hero, 1, [], rarity)[0];
                    if (option === undefined) break;
                    const direction = i % 3 === 0 ? -goodDelta(option) : goodDelta(option);
                    changePower(hero, option, direction, rarityMultiplier(rarity));
                }
                if (maxText === "max") {
                    const option = rollOptions(hero, 1)[0];
                    if (option !== undefined) maxOut(hero, option, goodDelta(option));
                }
            }
            say(`Gave ${bots} bot heroes ${count} free buffs each${maxText === "max" ? " and one maxed stat" : ""}.`);
        },
        "boost_botbuffs [count] [max]  (free random buffs for every bot hero, every third one lowered; max: also maxes one stat each)",
        0,
    );

    // Spawns an enemy ward next to your hero, so dewarding (and other enemy-item things) can be tested without
    // needing to actually control the enemy bots
    registerCommand(
        "boost_spawn_ward",
        (_, kind) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            const sentry = kind === "sentry";
            if (kind !== "observer" && !sentry) return say("Usage: boost_spawn_ward <observer|sentry>");

            const enemyTeam = hero.GetTeamNumber() === DotaTeam.GOODGUYS ? DotaTeam.BADGUYS : DotaTeam.GOODGUYS;
            const position = (hero.GetAbsOrigin() + Vector(150, 150, 0)) as Vector;
            const unitName = sentry ? "npc_dota_sentry_wards" : "npc_dota_observer_wards";
            const ward = CreateUnitByName(unitName, position, true, undefined, undefined, enemyTeam);
            if (ward === undefined) return say(`Could not create ${unitName}.`);
            say(`Spawned an enemy ${sentry ? "sentry" : "observer"} ward next to you. Attack it to test dewarding.`);
        },
        "boost_spawn_ward <observer|sentry>  (spawns an enemy ward next to your hero, to test dewarding)",
        0,
    );

    // Lists every modifier on your hero, to find how the game marks things like the chosen Scepter option
    registerCommand(
        "boost_modifiers",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            say(`Modifiers on ${hero.GetUnitName()}:`);
            // Looking for where the chosen Scepter option (Invoker: 1 Quas / 2 Wex / 3 Exort) is stored
            print(`  hero facet id: ${hero.GetHeroFacetID()}, Invoker Scepter option detected: ${invokerScepterOption(hero)}`);
            for (let slot = 0; slot < 17; slot++) {
                const item = hero.GetItemInSlot(slot);
                if (item === undefined || !item.GetAbilityName().includes("ultimate_scepter")) continue;
                print(`  ${item.GetAbilityName()} in slot ${slot}: charges ${item.GetCurrentCharges()}, secondary ${item.GetSecondaryCharges()}, level ${item.GetLevel()}`);
            }
            // Every ability slot, hidden ones included: a Scepter option might add or change a hidden sub-ability
            for (let i = 0; i < hero.GetAbilityCount(); i++) {
                const ability = hero.GetAbilityByIndex(i);
                if (ability === undefined) continue;
                print(`  ability ${i}: ${ability.GetAbilityName()} level ${ability.GetLevel()}${ability.IsHidden() ? " (hidden)" : ""} behavior ${tostring(ability.GetBehavior())}`);
            }
            for (const modifier of hero.FindAllModifiers()) {
                const ability = modifier.GetAbility();
                print(`  ${modifier.GetName()}${ability !== undefined ? ` (from ${ability.GetAbilityName()})` : ""} stacks ${modifier.GetStackCount()}`);
            }
        },
        "boost_modifiers  (prints every modifier on your hero)",
        0,
    );

    // In tools mode you are always the host: this shows the setup menu the way the other players see it (read-only)
    let setupGuest = false;
    registerCommand(
        "boost_setup_guest",
        () => {
            setupGuest = !setupGuest;
            CustomGameEventManager.Send_ServerToAllClients("boost_setup_guest", { on: setupGuest ? 1 : 0 });
            say(setupGuest ? "Setup menu: shown as a non-host sees it (read-only)." : "Setup menu: shown as the host again.");
        },
        "boost_setup_guest  (toggles: see the setup menu read-only, as players other than the host do)",
        0,
    );

    // Full health, mana and no cooldowns
    registerCommand(
        "boost_refresh",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            hero.SetHealth(hero.GetMaxHealth());
            hero.SetMana(hero.GetMaxMana());
            for (let i = 0; i < hero.GetAbilityCount(); i++) {
                hero.GetAbilityByIndex(i)?.EndCooldown();
            }
            say("Refreshed.");
        },
        "boost_refresh  (full health and mana, resets cooldowns)",
        0,
    );

    // --- Points economy (chunk 4) ---

    registerCommand(
        "boost_points",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            const info = getPoints(hero.GetPlayerOwnerID());
            say(`Points ${info.points}/${info.cost} (earned ${info.earned}, upgrades bought ${info.upgrades})`);
        },
        "boost_points  (your points, the cost of the next upgrade, total earned)",
        0,
    );

    registerCommand(
        "boost_givepoints",
        (_, amount) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            addPoints(hero.GetPlayerOwnerID(), tonumber(amount) ?? 100, "debug");
            say("Points added. See boost_points.");
        },
        "boost_givepoints <amount>  (debug: gives yourself points)",
        0,
    );

    // Makes every source (time, kills, ...) give more points, for testing
    registerCommand(
        "boost_pointrate",
        (_, rate) => {
            const value = tonumber(rate);
            if (value === undefined || value <= 0) return say(`Point rate is ${getPointRate()}. Usage: boost_pointrate <number>`);
            setPointRate(value);
            say(`All point gains are now x${value}. Use boost_pointrate 1 to go back to normal.`);
        },
        "boost_pointrate <number>  (testing: multiplies all point gains, 1 = normal)",
        0,
    );

    // Pays the cost, then offers 3 upgrades to pick from
    registerCommand(
        "boost_buy",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            if (pendingRoll.length > 0) return say("Pick your current offer first: boost_pick <1-3>");

            const playerId = hero.GetPlayerOwnerID();
            const info = getPoints(playerId);
            if (!spendForUpgrade(playerId)) return say(`Not enough points: ${info.points}/${info.cost}`);

            pendingRoll = rollOptions(hero, 3);
            say("Bought an upgrade. Choose one with boost_pick <1-3>:");
            pendingRoll.forEach((option, index) => print(`  ${index + 1}) ${describe(option)}`));
        },
        "boost_buy  (spends points, offers 3 upgrades)",
        0,
    );

    // --- Upgrade engine (chunk 3) ---

    // What the scanner found for one ability
    registerCommand(
        "boost_options",
        (_, abilityName) => {
            withAbility(abilityName, (_, ability) => {
                const options = getAbilityOptions(ability);
                say(`${options.length} upgrades possible for ${ability.GetAbilityName()}:`);
                for (const option of options) print(`  ${describe(option)}`);
            });
        },
        "boost_options <ability>  (what the scanner found for this ability)",
        0,
    );

    // Offers 3 random upgrades, like the cards players will see in chunk 5
    registerCommand(
        "boost_roll",
        () => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            pendingRoll = rollOptions(hero, 3);
            say("Choose one with boost_pick <1-3>:");
            pendingRoll.forEach((option, index) => print(`  ${index + 1}) ${describe(option)}`));
        },
        "boost_roll  (offers 3 random upgrades)",
        0,
    );

    registerCommand(
        "boost_pick",
        (_, choice) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            const option = pendingRoll[(tonumber(choice) ?? 0) - 1];
            if (option === undefined) return say("Use boost_roll first, then boost_pick <1-3>.");
            const result = applyUpgrade(hero, option);
            // applyUpgrade returns a multiplier, or a flat bonus for cast range
            const newValue = option.kind === "castrange" ? option.base + result : option.base * result;
            say(`Took ${option.ability}: ${option.label} ${option.base} -> ${string.format("%.2f", newValue)}`);
            pendingRoll = [];
        },
        "boost_pick <1-3>  (takes one of the rolled upgrades)",
        0,
    );

    // Debug: applies random upgrades without choosing
    registerCommand(
        "boost_random",
        (_, amount) => {
            const hero = commandHero();
            if (hero === undefined) return say("No hero found for you yet.");
            for (let i = 0; i < (tonumber(amount) ?? 1); i++) {
                const option = rollOptions(hero, 1)[0];
                if (option === undefined) return say("Nothing left to upgrade.");
                applyUpgrade(hero, option);
                print(`  ${describe(option)}`);
            }
            say("Random upgrades applied. See boost_show.");
        },
        "boost_random [count]  (debug: applies random upgrades)",
        0,
    );
}
