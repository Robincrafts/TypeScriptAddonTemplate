// The live game settings. Defaults, limits and menu texts are defined once here; the setup menu
// draws itself from `definitions`, and the rest of the game reads the numbers from `config`.

interface ConfigDefinition extends ConfigItem {
    default: number;
    /** Not in the menu: always the default value */
    hidden?: boolean;
}

/** "Tab|Section" -> the tab and the divider heading inside it. */
function splitGroup(group: string): [string, string] {
    const [tab, section] = group.split("|");
    return [tab, section ?? ""];
}

function number(
    group: string,
    key: keyof GameConfig,
    label: string,
    defaultValue: number,
    min: number,
    max: number,
    step: number,
    decimals = 0,
): ConfigDefinition {
    const [tab, section] = splitGroup(group);
    return { key, label, group: tab, section, kind: "number", default: defaultValue, min, max, step, decimals };
}

function toggle(group: string, key: keyof GameConfig, label: string, defaultValue: 0 | 1): ConfigDefinition {
    const [tab, section] = splitGroup(group);
    return { key, label, group: tab, section, kind: "toggle", default: defaultValue, min: 0, max: 1, step: 1, decimals: 0 };
}

/** Everything the host can change, in the order the menu shows it. */
export const definitions: ConfigDefinition[] = [
    number("Economy|Gold and XP", "startingGold", "Starting gold", 600, 0, 20000, 100),
    number("Economy|Gold and XP", "goldPerMinute", "Gold per minute", 150, 0, 3000, 25),
    number("Economy|Gold and XP", "creepGoldMultiplier", "Lane creep gold multiplier", 1.25, 0.25, 10, 0.25, 2),
    number("Economy|Gold and XP", "neutralGoldMultiplier", "Neutral creep gold multiplier", 1.25, 0.25, 10, 0.25, 2),
    number("Economy|Gold and XP", "heroGoldMultiplier", "Hero kill gold multiplier", 1, 0.25, 10, 0.25, 2),
    number("Economy|Gold and XP", "goldMultiplier", "Other gold multiplier (buildings, Roshan, runes)", 1.5, 0.25, 10, 0.25, 2),
    number("Economy|Gold and XP", "xpMultiplier", "XP multiplier", 2, 0.25, 10, 0.25, 2),
    number("Economy|Honey points", "pointsMultiplier", "Honey points multiplier", 1, 0.25, 20, 0.25, 2),
    number("Economy|Honey points", "pointsPerMinute", "Honey points per minute (just for playing)", 100, 0, 600, 5),
    number("Economy|Honey points", "startingUpgrades", "Free buffs at the start", 3, 0, 20, 1),
    number("Economy|Buff cost", "upgradeBaseCost", "Cost of the first buff", 100, 10, 2000, 10),
    number("Economy|Buff cost", "upgradeCostGrowth", "Extra cost after each buff", 0, 0, 500, 5),
    number("Economy|Buff cost", "upgradeCostPer5Minutes", "Extra cost every 5 minutes", 25, 0, 500, 5),

    number("Buffs|Buff size", "buffSizeStart", "Buff size at the start (% per common click)", 2, 0.5, 50, 0.5, 1),
    number("Buffs|Buff size", "buffSizeLate", "Buff size late game (% per common click)", 10, 0.5, 50, 0.5, 1),
    number("Buffs|Buff size", "buffSizeLateMinute", "Minute the late-game size is reached", 30, 1, 90, 1),
    number("Buffs|Buff size", "buffSizeMin", "Smallest buff size (% per common click)", 4, 0.5, 50, 0.5, 1),
    toggle("Buffs|Buff modifiers", "allowDebuffs", "Allow stun / silence / slow buffs", 1),
    toggle("Buffs|Buff modifiers", "allowSkillDurations", "Allow skill duration buffs", 1),
    toggle("Buffs|Buff modifiers", "allowTurnRate", "Allow turn rate buffs", 1),
    toggle("Buffs|Buff modifiers", "allowTickRate", "Allow tick rate buffs", 1),
    toggle("Buffs|Buff modifiers", "allowProcChance", "Allow proc chance buffs", 1),
    toggle("Buffs|Buff modifiers", "allowCooldown", "Allow cooldown buffs", 0),
    toggle("Buffs|Buff modifiers", "allowUnitCounts", "Allow unit and illusion count buffs", 0),
    toggle("Buffs|Buff modifiers", "randomCooldown", "Random cooldown on buffed skills", 0),

    number("Match|Respawn", "respawnScale", "Respawn time scale (1 = normal Dota, 0.75 = Turbo)", 0.75, 0.1, 2, 0.05, 2),
    number("Match|Respawn", "fixedRespawnTime", "Fixed respawn time in seconds (0 = off)", 0, 0, 180, 1),
    toggle("Match|Respawn", "randomRespawn", "Random respawn time, growing over the game", 0),
    number("Match|Respawn", "maxRespawnTime", "Longest respawn time in seconds (0 = no limit)", 30, 0, 180, 5),
    number("Heroes|Hero growth", "healthFlatPerMinute", "Health per minute", 20, 0, 200, 5),
    number("Heroes|Hero growth", "healthGrowthMax", "Health growth limit", 600, 0, 5000, 50),
    number("Heroes|Hero growth", "armorPer5Minutes", "Armor per 5 minutes", 1, 0, 5, 0.5, 1),
    toggle("Match|Shop and courier", "universalShop", "Universal shop (buy everything anywhere)", 1),
    number("Match|Shop and courier", "shardMinute", "Aghanim's Shard available from minute", 0, 0, 15, 1),
    number("Match|Shop and courier", "courierSpeedMultiplier", "Courier speed multiplier", 10, 0.5, 10, 0.25, 2),
    toggle("Match|Shop and courier", "flyingCourier", "Flying courier from the start", 1),
    number("Match|Shop and courier", "teleportCooldown", "Teleport Scroll cooldown (seconds, 0 = normal)", 20, 0, 120, 5),
    number("Buffs|Buff list", "rowsPerList", "Buffs offered per list", 6, 3, 8, 1),
    number("Buffs|Rarity chances", "rarityCommon", "Common (grey)", 57, 0, 100, 1),
    number("Buffs|Rarity chances", "rarityRare", "Rare (blue)", 28, 0, 100, 1),
    number("Buffs|Rarity chances", "rarityEpic", "Epic (purple)", 13, 0, 100, 1),
    number("Buffs|Rarity chances", "rarityLegendary", "Legendary (gold)", 2, 0, 100, 1),
    number("Towers", "towerHealthMultiplier", "Tower health multiplier", 1, 0.25, 20, 0.25, 2),
    number("Towers", "towerArmorBonus", "Tower armor bonus", 0, -10, 100, 1),
    number("Towers", "towerHealthPerMinute", "Tower health growth per minute (%)", 0, 0, 20, 0.5, 1),
    number("Towers", "towerHealthMaxGrowth", "Tower health growth limit (x)", 2.5, 1, 10, 0.25, 2),
    number("Towers", "towerArmorPer5Minutes", "Tower armor growth per 5 minutes", 0, 0, 10, 0.5, 1),
    number("Towers", "towerArmorMaxGrowth", "Tower armor growth limit", 15, 0, 100, 1),
    number("Towers", "towerDamageStartMinute", "Tower damage starts growing at minute", 0, 0, 60, 1),
    number("Towers", "towerDamageFullMinute", "Tower damage fully grown at minute", 0, 0, 90, 1),
    number("Towers", "towerDamageVsCreeps", "Tower damage vs creeps, fully grown (x)", 1, 1, 20, 0.25, 2),
    number("Towers", "towerDamageVsHeroes", "Tower damage vs heroes, fully grown (x)", 3, 1, 20, 0.25, 2),
    number("Towers", "towerDamageVsIllusions", "Tower damage vs illusions, fully grown (x)", 5, 1, 30, 0.5, 1),
    number("Match|Game start", "preGameTime", "Countdown before the horn (seconds)", 45, 5, 90, 5),
    number("Match|Game end", "killLimit", "Kill limit (0 = off)", 0, 0, 500, 5),
    number("Match|Game end", "timeLimit", "Time limit in minutes (0 = off)", 0, 0, 180, 5),
];

/** Tooltips for the (i) icons. Settings that explain themselves have none. */
const helpTexts: Partial<Record<keyof GameConfig, string>> = {
    creepGoldMultiplier: "Multiplies gold from killing lane creeps. 2 = twice the gold.",
    neutralGoldMultiplier: "Multiplies gold from killing neutral creeps in the jungle.",
    heroGoldMultiplier: "Multiplies gold from killing heroes (and assists).",
    goldMultiplier: "Multiplies all other gold income: buildings, Roshan, bounty runes and shared gold.",
    xpMultiplier: "Multiplies all experience. 2 = heroes level up about twice as fast.",
    pointsMultiplier: "Multiplies all honey points earned from kills, creeps and objectives.",
    pointsPerMinute: "Honey points every player gets over time, even without kills.",
    startingUpgrades: "Everyone starts with enough honey points for this many buffs.",
    upgradeBaseCost: "Honey points needed for the first buff.",
    upgradeCostGrowth: "Every buff after the first costs this much more than the one before.",
    upgradeCostPer5Minutes: "Every 5 minutes of game time, all buffs cost this much more (100 at the start, 150 at minute 10 with 25).",
    rowsPerList: "How many buffs each list offers to choose from.",
    preGameTime: "Seconds between hero selection and the horn, to buy items and walk to lane. Normal Dota is 90.",
    rarityCommon: "Relative odds of each rarity. With 57/28/13/2, about 1 row in 50 is legendary.",
    rarityRare: "Rare rows change a stat 1.5 times as much as common ones.",
    rarityEpic: "Epic rows change a stat twice as much as common ones.",
    rarityLegendary: "Legendary rows change a stat 3 times as much as common ones.",
    buffSizeStart: "How much one common click changes a stat at minute 0. Rare x1.5, epic x2, legendary x3. Some stats (area, range, mana cost, cooldown) move less.",
    buffSizeLate: "How much one common click changes a stat once the late-game minute is reached. Grows evenly until then.",
    buffSizeLateMinute: "Game minute at which clicks reach the late-game size.",
    buffSizeMin: "A click is never worth less than this. Makes early buffs bigger; later the growing size is above it anyway.",
    allowCooldown: "Lets players change skill cooldowns. Off by default: it gets overpowered fast.",
    allowDebuffs: "Lets players change how long stuns, roots, silences and other disables last, how strong and long slows are, and linger and knockback durations.",
    allowSkillDurations: "Lets players change how long a skill's own effect lasts (empower, ultimates like Stone Gaze or Rolling Thunder...).",
    allowUnitCounts: "Lets players change how many units or illusions a skill makes (illusions, treants, soldiers...).",
    allowTurnRate: "Lets players change turn rates (how fast a hero or skill turns).",
    allowTickRate: "Lets players change tick rates: how often a skill deals its damage or effect (e.g. every 0.5 s).",
    allowProcChance: "Lets players change a skill's chance to proc (e.g. Faceless Void's Time Lock). Dodge and evasion stay off (too strong to buff).",
    randomCooldown: "After each cast, a buffed skill's cooldown varies a little. More buffs, more variation.",
    respawnScale: "Multiplies Dota's normal respawn time, which grows with hero level. 0.75 = Turbo (25% faster).",
    fixedRespawnTime: "Every hero respawns after exactly this many seconds, whatever its level. Overrides the scale.",
    randomRespawn: "Each death rolls a respawn time around the normal value, varying more as the game goes on.",
    maxRespawnTime: "No hero waits longer than this to respawn. Short early-game timers are not changed.",
    healthFlatPerMinute: "Every hero gains this much max health each minute, so strong skills don't one-shot late.",
    healthGrowthMax: "Heroes stop gaining health from growth after this much (600 = reached at minute 30 with 20 per minute).",
    armorPer5Minutes: "Every hero gains this much armor every 5 minutes.",
    universalShop: "Buy secret shop and side shop items from any shop.",
    shardMinute: "Game minute from which Aghanim's Shard can be bought. Dota's normal time is 15.",
    courierSpeedMultiplier: "Multiplies courier movement speed. 10 = ten times as fast.",
    flyingCourier: "Couriers fly over trees and cliffs from the first second, like in Turbo mode.",
    teleportCooldown: "Cooldown of the Teleport Scroll. Cooldown items like Octarine Core still lower it further.",
    towerHealthMultiplier: "Multiplies tower health. 2 = towers take twice as long to destroy.",
    towerArmorBonus: "Extra armor on every tower.",
    towerHealthPerMinute: "Every minute towers gain this much of their starting health (keeping the share they have left).",
    towerHealthMaxGrowth: "Tower health stops growing at this multiple of its starting health (2.5 = reached at minute 30 with 5%).",
    towerArmorPer5Minutes: "Extra tower armor every 5 minutes.",
    towerArmorMaxGrowth: "Tower armor stops growing after this much extra armor.",
    towerDamageStartMinute: "Tower attacks do normal damage until this minute, then grow evenly.",
    towerDamageFullMinute: "Minute at which tower attacks reach their full multipliers below. The same as the start minute (default 0) = full strength right away.",
    towerDamageVsCreeps: "Tower attack damage against creeps and summons once fully grown.",
    towerDamageVsHeroes: "Tower attack damage against heroes once fully grown.",
    towerDamageVsIllusions: "Tower attack damage against illusions once fully grown.",
    killLimit: "The first team to reach this many hero kills wins.",
    timeLimit: "The game ends after this many minutes; the team with more kills wins.",
};
for (const definition of definitions) definition.help = helpTexts[definition.key as keyof GameConfig];

/** Settings taken out of the menu: they keep their default value and the host cannot change them. */
const hiddenKeys: (keyof GameConfig)[] = [
    "universalShop", // always on (Turbo-like: Secret Shop items at any shop); see shop.ts for buying away from shops
    "flyingCourier", // couriers always fly
    "courierSpeedMultiplier", // couriers always run at the highest speed
    "buffSizeStart", // buff sizes: hard to understand in the menu for now
    "buffSizeLate",
    "buffSizeLateMinute",
    "buffSizeMin",
    "shardMinute",
    "teleportCooldown",
    "fixedRespawnTime",
];
for (const definition of definitions) {
    if (hiddenKeys.includes(definition.key as keyof GameConfig)) definition.hidden = true;
}

/** The current values. Read them anywhere; change them through setConfigValue. */
export const config = {} as GameConfig;

function definitionOf(key: string): ConfigDefinition | undefined {
    return definitions.find(definition => definition.key === key);
}

export function resetConfig() {
    for (const definition of definitions) (config as any)[definition.key] = definition.default;
}

/** Puts a value into the config, kept inside the limits and snapped to the step. Returns false for an unknown key. */
export function setConfigValue(key: string, value: number): boolean {
    const definition = definitionOf(key);
    if (definition === undefined || definition.hidden || typeof value !== "number") return false;

    let clamped = math.min(math.max(value, definition.min), definition.max);
    clamped = math.floor((clamped - definition.min) / definition.step + 0.5) * definition.step + definition.min;
    // Rounding removes float noise such as 0.30000000000000004
    (config as any)[key] = tonumber(string.format(`%.${definition.decimals}f`, clamped)) ?? definition.default;
    return true;
}

/** Sends the menu list and the current values to the clients. */
export function publishConfig() {
    CustomNetTables.SetTableValue("boost_config", "schema", {
        items: definitions.filter(definition => !definition.hidden).map(({ default: _, hidden: __, ...item }) => item),
    });
    CustomNetTables.SetTableValue("boost_config", "values", { ...config });
}

resetConfig();
