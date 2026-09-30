// Lists every buffable value Dota shows as a percentage (tooltip label starting with "%", see tooltip_data.ts) with
// its stat type, base and late-game ceiling from the last `boost_audit_every` run in console.log. Flags ceilings above
// 100% ("!!") and pool damage, to review % caps in one go.
// Usage (from dota_boosted/, after boost_audit_every in game):  node scripts/check_percent.js [--all]
// Without --all only flagged lines are printed.
const fs = require("fs");
const path = require("path");
const { getDotaPath } = require("./utils");

(async () => {
    const tooltipSource = fs.readFileSync(path.resolve(__dirname, "..", "src", "vscripts", "boost", "tooltip_data.ts"), "utf8");
    const tooltips = {};
    for (const match of tooltipSource.matchAll(/^\s+"([^"]+)": "([^"]*)",$/gm)) tooltips[match[1]] = match[2];

    const consoleLog = path.join(await getDotaPath(), "game", "dota", "console.log");
    let rows = new Map();
    let ability;
    let heroes = new Set();
    for (const line of fs.readFileSync(consoleLog, "utf8").split(/\r?\n/)) {
        const at = line.indexOf("[audit]");
        if (at < 0) continue;
        const body = line.slice(at + 7);
        // A hero seen again starts a new audit run: only the last run counts (stats hidden since then drop out)
        const hero = /^ (npc_dota_hero_\w+)/.exec(body);
        if (hero) {
            if (heroes.has(hero[1])) {
                rows = new Map();
                heroes = new Set();
            }
            heroes.add(hero[1]);
            continue;
        }
        const abilityMatch = /^ {3}([a-z0-9_]+)(?: \([^)]*\))*:\s*$/.exec(body);
        if (abilityMatch) {
            ability = abilityMatch[1];
            continue;
        }
        const value = /^ {5}.*\[([A-Za-z0-9_]+)\] \(base ([-\d.e]+), better (up|down); ([^:]+): click ([^,]+), (?:max|min) now ([-\d.e]+) \/ late ([-\d.e]+)\)/.exec(body);
        if (!value || !ability) continue;
        const key = `${ability}|${value[1]}`;
        const label = tooltips[key];
        if (!label || !label.startsWith("%")) continue;
        // A later audit run wins over an earlier one
        rows.set(key, { key, label, base: +value[2], better: value[3], type: value[4], click: value[5], late: +value[7] });
    }
    if (rows.size === 0) throw new Error("No [audit] lines for % values in console.log: run boost_audit_every first.");

    const all = process.argv.includes("--all");
    const sorted = [...rows.values()].sort((a, b) => b.late - a.late);
    let flagged = 0;
    for (const row of sorted) {
        const over = row.better === "up" && row.late > 100;
        const pool = row.type.includes("pool");
        const startsHigh = row.base > 100 || row.base < -100;
        if (over) flagged++;
        if (!all && !over && !pool && !startsHigh) continue;
        const mark = over ? "!!" : startsHigh ? "hi" : pool ? "po" : "  ";
        console.log(`${mark} ${row.key.padEnd(62)} ${row.type.padEnd(28)} base ${String(row.base).padStart(6)}  late ${String(row.late).padStart(7)}  ${row.label}`);
    }
    console.log(`\n${rows.size} % stats, ${flagged} with a late ceiling above 100% (!!); "hi" = starts above 100%; "po" = pool damage.`);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
