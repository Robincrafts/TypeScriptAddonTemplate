// Server side of the game setup menu: the host changes settings while the game is still in the
// setup phase (before hero selection), can save and load presets, and starts the game.
// Only the host may change anything; the values are checked and kept inside their limits by config.ts.
import { publishConfig, resetConfig, setConfigValue } from "./config";
import { applyUniversalShop } from "./shop";
import { cleanPresetName, deletePreset, listPresetNames, loadPreset, savePreset } from "./presets";

let statusVersion = 0;

/** Shows a message in the menu ("Saved", "Could not write the file", ...). */
function setStatus(message: string) {
    statusVersion += 1;
    CustomNetTables.SetTableValue("boost_setup", "status", { message, version: statusVersion });
}

function publishPresets() {
    CustomNetTables.SetTableValue("boost_presets", "list", { names: listPresetNames() });
}

function inSetup(): boolean {
    return GameRules.State_Get() === GameState.CUSTOM_GAME_SETUP;
}

/** In tools mode there is only you, so you are always the host. */
function isHost(playerId: PlayerID): boolean {
    if (IsInToolsMode()) return true;
    const player = PlayerResource.GetPlayer(playerId);
    return player !== undefined && GameRules.PlayerHasCustomGameHostPrivileges(player);
}

export function registerLobbySettings() {
    publishConfig();
    publishPresets();
    setStatus(
        (_G as any).io === undefined
            ? "Saving presets only works while testing with the workshop tools."
            : "Change the settings, then press Start Game.",
    );

    CustomGameEventManager.RegisterListener("boost_config_set", (_, event) => {
        if (!inSetup() || !isHost(event.PlayerID)) return;
        if (setConfigValue(event.key, event.value)) {
            publishConfig();
            if (event.key === "universalShop") applyUniversalShop();
        }
    });

    CustomGameEventManager.RegisterListener("boost_config_reset", (_, event) => {
        if (!inSetup() || !isHost(event.PlayerID)) return;
        resetConfig();
        publishConfig();
        setStatus("Back to the default settings.");
    });

    CustomGameEventManager.RegisterListener("boost_config_preset", (_, event) => {
        if (!inSetup() || !isHost(event.PlayerID)) return;

        const name = cleanPresetName(event.name);
        if (name === "") return setStatus("Type a preset name first (letters, digits, spaces, - and _).");

        if (event.action === "save") {
            const error = savePreset(name);
            setStatus(error ?? `Saved preset "${name}".`);
        } else if (event.action === "load") {
            if (loadPreset(name)) {
                publishConfig();
                setStatus(`Loaded preset "${name}".`);
            } else {
                setStatus(`There is no preset called "${name}".`);
            }
        } else if (event.action === "delete") {
            const error = deletePreset(name);
            setStatus(error ?? `Deleted preset "${name}".`);
        }
        publishPresets();
    });

    CustomGameEventManager.RegisterListener("boost_config_start", (_, event) => {
        if (!inSetup() || !isHost(event.PlayerID)) return;
        setStatus("Starting...");
        // A moment for the host's screen to assign the players to teams before setup ends
        Timers.CreateTimer(0.5, () => {
            GameRules.FinishCustomGameSetup();
        });
    });
}
