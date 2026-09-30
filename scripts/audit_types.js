// Lists stats of one `boost_audit` type from the last `boost_audit_every` run in console.log, with base, common click
// and ceilings, to pick real examples when reviewing caps.
// Usage (from dota_boosted/):  node scripts/audit_types.js            -> every type with its count
//                              node scripts/audit_types.js "proc chance" [limit]
const fs = require("fs");
const path = require("path");
const { getDotaPath } = require("./utils");

(async () => {
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
        const value = /^ {5}(.*) \[([A-Za-z0-9_]+)\] \(base ([-\d.e]+), better (up|down); ([^:]+): click ([^,]+), ((?:max|min) now [-\d.e]+ \/ late [-\d.e]+)\)/.exec(body);
        if (!value || !ability) continue;
        // A later audit run wins over an earlier one
        rows.set(`${ability}|${value[2]}`, { ability, label: value[1], base: value[3], type: value[5], click: value[6], edge: value[7] });
    }
    if (rows.size === 0) throw new Error("No [audit] lines in console.log: run boost_audit_every first.");

    const wanted = process.argv[2];
    if (wanted === undefined) {
        const counts = {};
        for (const row of rows.values()) counts[row.type] = (counts[row.type] ?? 0) + 1;
        for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(5)}  ${type}`);
        return;
    }
    const limit = Number(process.argv[3] ?? 40);
    const matches = [...rows.values()].filter(row => row.type === wanted);
    for (const row of matches.slice(0, limit)) {
        console.log(`${`${row.ability} ${row.label}`.padEnd(70)} base ${row.base.padStart(6)}  click ${row.click.padEnd(6)} ${row.edge}`);
    }
    console.log(`\n${matches.length} stats of type "${wanted}"${matches.length > limit ? ` (first ${limit} shown)` : ""}.`);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
