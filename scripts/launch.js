const { spawn } = require("child_process");
const path = require("path");
const { getAddonName, getDotaPath } = require("./utils");

(async () => {
    const dotaPath = await getDotaPath();
    const win64 = path.join(dotaPath, "game", "bin", "win64");

    // You can add any arguments there
    // `+dota_launch_custom_game <addon> <map>` loads that map right away. Each map is a hero pick mode (pick_modes.ts):
    // all_pick, single_draft, all_random. Another one: `npm run launch -- single_draft`.
    // -condebug saves the whole console to game/dota/console.log (Lua cannot write files, so reports go through it)
    const map = process.argv[2] ?? "all_pick";
    const args = ["-novid", "-tools", "-condebug", "-addon", getAddonName(), `+dota_launch_custom_game ${getAddonName()} ${map}`];
    spawn(path.join(win64, "dota2.exe"), args, { detached: true, cwd: win64 });
})().catch(error => {
    console.error(error);
    process.exit(1);
});
