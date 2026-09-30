// Compiles the Panorama UI (layout, styles, scripts) into the .vxml_c / .vcss_c / .vjs_c files that normal Dota
// and the published game load. Tools mode reads the source files, so without this the published UI goes stale.
const { spawnSync } = require("child_process");
const path = require("path");
const { getAddonName, getDotaPath } = require("./utils");

(async () => {
    const dotaPath = await getDotaPath();
    const win64 = path.join(dotaPath, "game", "bin", "win64");
    const input = path.join(dotaPath, "content", "dota_addons", getAddonName(), "panorama", "*");
    const result = spawnSync(path.join(win64, "resourcecompiler.exe"), ["-game", "dota", "-f", "-r", "-i", input], {
        cwd: win64,
        encoding: "utf8",
    });
    const summary = (result.stdout || "").split("\n").filter(line => /OK:|failed|ERROR/i.test(line));
    console.log(summary.join("\n") || result.stdout);
    process.exit(result.status ?? 1);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
