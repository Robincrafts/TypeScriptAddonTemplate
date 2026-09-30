// Compiles the pick-mode maps (content/maps/<name>.vmap -> game/maps/<name>.vpk) with Dota's resource compiler, the
// same steps Hammer's "Build" runs (world, physics, visibility, grid nav). Each map is a copy of the Dota map; the mode
// comes from its name (pick_modes.ts). Slow: several minutes per map.
// Usage (from dota_boosted/): node scripts/compile-maps.js [map ...]   (default: all_pick single_draft all_random)
const { spawnSync } = require("child_process");
const path = require("path");
const { getAddonName, getDotaPath } = require("./utils");

(async () => {
    const dotaPath = await getDotaPath();
    const win64 = path.join(dotaPath, "game", "bin", "win64");
    const maps = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["all_pick", "single_draft", "all_random"];
    for (const map of maps) {
        const input = path.join(dotaPath, "content", "dota_addons", getAddonName(), "maps", `${map}.vmap`);
        console.log(`Compiling ${map}...`);
        const started = Date.now();
        const result = spawnSync(
            path.join(win64, "resourcecompiler.exe"),
            ["-game", "dota", "-fshallow", "-i", input, "-world", "-phys", "-vis", "-gridnav", "-nop4", "-nompi", "-unbufferedio"],
            { cwd: win64, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
        );
        const lines = (result.stdout || "").split("\n");
        const important = lines.filter(line => /OK:|failed|ERROR|error/i.test(line)).slice(-20);
        console.log(important.join("\n") || lines.slice(-20).join("\n"));
        console.log(`${map}: exit ${result.status} after ${Math.round((Date.now() - started) / 1000)} s`);
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
