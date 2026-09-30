// Saves named presets of the game settings to a text file on this PC.
// This relies on Lua's `io` library. Dota only allows it while testing with the workshop tools;
// in a published game `io` is missing and the functions report that instead of crashing.
//
// File format, one preset per line:   Name|key=value;key=value;...
import { config, definitions, setConfigValue } from "./config";

// Relative to Dota's working directory (game/bin/win64). The first path is the addon folder, the second a fallback.
const FILE_PATHS = ["../../dota_addons/dota_boosted/presets.txt", "presets.txt"];

/** Presets are keyed by name; values are the settings of the preset. */
type PresetMap = Record<string, Record<string, number>>;

function ioAvailable(): boolean {
    return (_G as any).io !== undefined;
}

const ALLOWED_NAME_CHARACTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-";

/** Only letters, digits, spaces, "_" and "-" (max 24), so the name can never break the file format. */
export function cleanPresetName(name: string): string {
    let clean = "";
    for (let i = 0; i < name.length; i++) {
        const character = name.charAt(i);
        if (ALLOWED_NAME_CHARACTERS.includes(character)) clean += character;
    }
    return clean.trim().substring(0, 24);
}

/** Reads all presets. Returns the presets in file order and, separately, their names in that order. */
function readAll(): { presets: PresetMap; names: string[] } {
    const presets: PresetMap = {};
    const names: string[] = [];
    if (!ioAvailable()) return { presets, names };

    for (const path of FILE_PATHS) {
        const [file] = io.open(path, "r");
        if (file === undefined) continue;

        const content = file.read("*a") as string | undefined;
        file.close();
        for (const line of (content ?? "").split("\n")) {
            const [name, body] = line.split("|");
            if (name === undefined || body === undefined || name === "") continue;

            const values: Record<string, number> = {};
            for (const pair of body.split(";")) {
                const [key, text] = pair.split("=");
                const value = tonumber(text);
                if (key !== undefined && value !== undefined) values[key] = value;
            }
            if (presets[name] === undefined) names.push(name);
            presets[name] = values;
        }
        break; // the first file that exists wins
    }
    return { presets, names };
}

/** Writes all presets. Returns an error text, or undefined if it worked. */
function writeAll(presets: PresetMap, names: string[]): string | undefined {
    if (!ioAvailable()) return "Saving files only works while testing with the workshop tools.";

    const lines: string[] = [];
    for (const name of names) {
        const parts: string[] = [];
        for (const definition of definitions) {
            const value = presets[name]?.[definition.key];
            if (value !== undefined) parts.push(`${definition.key}=${value}`);
        }
        lines.push(`${name}|${parts.join(";")}`);
    }

    let lastError = "unknown error";
    for (const path of FILE_PATHS) {
        const [file, error] = io.open(path, "w");
        if (file === undefined) {
            lastError = tostring(error);
            continue;
        }
        file.write(lines.join("\n") + "\n");
        file.close();
        return undefined;
    }
    return `Could not write the presets file (${lastError}).`;
}

export function listPresetNames(): string[] {
    return readAll().names;
}

/** Saves the current settings under `name` (replacing a preset of the same name). Returns an error text, or undefined. */
export function savePreset(name: string): string | undefined {
    const { presets, names } = readAll();
    if (presets[name] === undefined) names.push(name);

    const values: Record<string, number> = {};
    for (const definition of definitions) values[definition.key] = (config as any)[definition.key];
    presets[name] = values;
    return writeAll(presets, names);
}

/** Puts the settings of preset `name` into the config. Returns false if there is no such preset. */
export function loadPreset(name: string): boolean {
    const preset = readAll().presets[name];
    if (preset === undefined) return false;

    for (const definition of definitions) {
        const value = preset[definition.key];
        // Settings missing from an older preset keep their current value
        if (value !== undefined) setConfigValue(definition.key, value);
    }
    return true;
}

/** Removes preset `name`. Returns an error text, or undefined. */
export function deletePreset(name: string): string | undefined {
    const { presets, names } = readAll();
    if (presets[name] === undefined) return undefined;

    delete presets[name];
    return writeAll(
        presets,
        names.filter(existing => existing !== name),
    );
}
