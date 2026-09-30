// Game setup screen (our settings menu). It is shown before hero selection. The server publishes:
//   boost_config  - the list of settings ("schema") and their current values
//   boost_presets - the names of the presets saved on this PC
//   boost_setup   - the last status message
// This script draws the settings from that list, so a new setting on the server shows up here by itself.
// It only sends what the host clicked; the server checks and keeps the values inside their limits.
//
// Everything is wrapped in a function so its names do not clash with the other UI scripts.

(() => {
    const root = $.GetContextPanel();
    const settingsList = $("#SettingsList");
    const groupTabs = $("#GroupTabs");
    const presetList = $("#PresetList");

    const rowsByKey: Record<string, Panel> = {};
    let items: ConfigItem[] = [];
    let itemSignature = "";
    let values: Record<string, number> = {};

    /** Net tables turn arrays into objects keyed 1, 2, 3...; this turns them back. */
    function toArray<T>(obj: Record<number, T> | undefined | null): T[] {
        const result: T[] = [];
        if (!obj) return result;

        let key = 1;
        while ((obj as Record<number, T>)[key]) {
            result.push((obj as Record<number, T>)[key]);
            key++;
        }
        return result;
    }

    function label(id: string, parent: Panel): LabelPanel {
        return parent.FindChildTraverse(id) as LabelPanel;
    }

    /** Debug (boost_setup_guest): the host sees the menu as the other players do */
    let viewAsGuest = false;

    /** In tools mode there is only you; otherwise only the lobby host may change settings. */
    function isHost(): boolean {
        if (viewAsGuest) return false;
        if (Game.IsInToolsMode()) return true;
        const info = Game.GetPlayerInfo(Game.GetLocalPlayerID());
        // Until the player info arrives nobody counts as host, so other players never see the menu flash up
        return !!info && !!info.player_has_host_privileges;
    }

    /** Sends an event to the server, if the local player is the host (the server checks this again). */
    function send(event: keyof CustomGameEventDeclarations, data: object) {
        if (isHost()) GameEvents.SendCustomGameEventToServer<object>(event, data);
    }

    function formatValue(item: ConfigItem, value: number): string {
        return value.toFixed(item.decimals);
    }

    // ---- Tooltip of the (i) icons ----

    // The context panel has no flow layout, so this box floats on top of the menu instead of pushing rows down
    const tooltip = $.CreatePanel("Label", root, "SettingTooltip");
    tooltip.hittest = false;
    let pinnedInfo: Panel | undefined;

    function showTooltip(icon: Panel, text: string) {
        const iconPos = icon.GetPositionWithinWindow();
        const rootPos = root.GetPositionWithinWindow();
        const scale = root.actualuiscale_x || 1;
        const x = (iconPos.x - rootPos.x) / scale + 30;
        const y = (iconPos.y - rootPos.y) / scale - 8;
        tooltip.text = text;
        tooltip.style.position = `${Math.round(x)}px ${Math.round(y)}px 0px`;
        tooltip.AddClass("Shown");
    }

    function hideTooltip() {
        tooltip.RemoveClass("Shown");
    }

    // ---- Settings: one group at a time ----

    let selectedGroup = "";
    /**
     * The panel starts as a narrow strip of tabs and only opens to full size when a tab is clicked; clicking the open
     * tab again folds it back (user 2026-09-30). Everyone, host or not, can open it.
     */
    let expanded = false;

    function groupNames(): string[] {
        const names: string[] = [];
        for (const item of items) if (!names.includes(item.group)) names.push(item.group);
        return names;
    }

    /**
     * Players other than the host see the same menu, read-only: values update live, nothing can be changed. Unknown
     * until the first check in updateVisibility (which runs before the rows are drawn).
     */
    let readOnly: boolean | undefined;

    function updateRow(item: ConfigItem) {
        const row = rowsByKey[item.key];
        const value = values[item.key];
        if (!row || value === undefined) return;
        const control = row.FindChildTraverse(item.kind === "toggle" ? "ToggleButton" : "RowInput");
        if (control) control.enabled = !readOnly;

        if (item.kind === "toggle") {
            row.SetHasClass("On", value === 1);
            label("ToggleText", row).text = value === 1 ? "ON" : "OFF";
        } else {
            const input = row.FindChildTraverse("RowInput") as TextEntry;
            // Do not overwrite what is being typed
            if (!input.BHasKeyFocus()) input.text = formatValue(item, value);
        }
    }

    /** Reads the typed number and sends it; the server clamps it to the allowed range. */
    function submitInput(item: ConfigItem, input: TextEntry) {
        const typed = parseFloat(input.text);
        if (isNaN(typed)) {
            input.text = formatValue(item, values[item.key]);
            return;
        }
        send("boost_config_set", { key: item.key, value: typed });
        // Show the number as it will be kept (clamped) once the server answers
        input.text = formatValue(item, Math.min(Math.max(typed, item.min), item.max));
    }

    function buildGroup() {
        settingsList.RemoveAndDeleteChildren();
        for (const key in rowsByKey) delete rowsByKey[key];

        let section: string | undefined = undefined;
        for (const item of items) {
            if (item.group !== selectedGroup) continue;

            // A divider with a heading whenever a new section of the tab starts
            if (item.section && item.section !== section) {
                const header = $.CreatePanel("Panel", settingsList, "");
                header.BLoadLayoutSnippet("SectionHeader");
                header.SetHasClass("First", section === undefined);
                label("SectionTitle", header).text = item.section;
            }
            section = item.section;

            const row = $.CreatePanel("Panel", settingsList, "");
            row.BLoadLayoutSnippet(item.kind === "toggle" ? "ToggleRow" : "NumberRow");
            label("RowLabel", row).text = item.label;
            const info = label("RowInfo", row);
            if (item.help) {
                // Our own floating box: Dota's tooltips do not reach this overlay
                const help = item.help;
                info.AddClass("HasHelp");
                info.SetPanelEvent("onmouseover", () => showTooltip(info, help));
                info.SetPanelEvent("onmouseout", () => {
                    if (pinnedInfo !== info) hideTooltip();
                });
                info.SetPanelEvent("onactivate", () => {
                    pinnedInfo = pinnedInfo === info ? undefined : info;
                    if (pinnedInfo) showTooltip(info, help);
                    else hideTooltip();
                });
            }
            rowsByKey[item.key] = row;

            if (item.kind === "toggle") {
                row.FindChildTraverse("ToggleButton")!.SetPanelEvent("onactivate", () => {
                    send("boost_config_set", { key: item.key, value: values[item.key] === 1 ? 0 : 1 });
                });
            } else {
                const input = row.FindChildTraverse("RowInput") as TextEntry;
                label("RowRange", row).text = `${formatValue(item, item.min)} - ${formatValue(item, item.max)}`;
                input.SetPanelEvent("oninputsubmit", () => submitInput(item, input));
                input.SetPanelEvent("onblur", () => submitInput(item, input));
            }
            updateRow(item);
        }
    }

    function buildTabs() {
        groupTabs.RemoveAndDeleteChildren();
        for (const name of groupNames()) {
            const tab = $.CreatePanel("Panel", groupTabs, "");
            tab.BLoadLayoutSnippet("GroupTab");
            label("TabText", tab).text = name;
            tab.SetHasClass("Selected", expanded && name === selectedGroup);
            tab.SetPanelEvent("onactivate", () => {
                pinnedInfo = undefined;
                hideTooltip();
                expanded = !(expanded && name === selectedGroup);
                selectedGroup = name;
                root.SetHasClass("Expanded", expanded);
                buildTabs();
                buildGroup();
            });
        }
    }

    function refreshConfig() {
        const schema = CustomNetTables.GetTableValue("boost_config", "schema");
        const current = CustomNetTables.GetTableValue("boost_config", "values");
        if (!schema || !current) return;

        values = current as unknown as Record<string, number>;
        items = toArray(schema.items as unknown as Record<number, ConfigItem>);

        // Rebuild the tabs and rows only when the list of settings itself changed
        const signature = items.map(item => item.key).join(",");
        if (signature !== itemSignature) {
            itemSignature = signature;
            if (!groupNames().includes(selectedGroup)) selectedGroup = groupNames()[0] ?? "";
            buildTabs();
            buildGroup();
        } else {
            for (const item of items) updateRow(item);
        }
    }

    // ---- Presets ----

    function presetName(): string {
        return (root.FindChildTraverse("PresetNameEntry") as TextEntry).text;
    }

    function refreshPresets() {
        const list = CustomNetTables.GetTableValue("boost_presets", "list");
        presetList.RemoveAndDeleteChildren();
        if (!list) return;

        for (const name of toArray(list.names as unknown as Record<number, string>)) {
            const row = $.CreatePanel("Panel", presetList, "");
            row.BLoadLayoutSnippet("PresetRow");
            label("PresetName", row).text = name;

            // Clicking the name loads the preset and copies the name into the box, so it can be overwritten with Save
            row.FindChildTraverse("PresetNameButton")!.SetPanelEvent("onactivate", () => {
                (root.FindChildTraverse("PresetNameEntry") as TextEntry).text = name;
                send("boost_config_preset", { action: "load", name });
            });
            row.FindChildTraverse("LoadButton")!.SetPanelEvent("onactivate", () => {
                send("boost_config_preset", { action: "load", name });
            });
            row.FindChildTraverse("DeleteButton")!.SetPanelEvent("onactivate", () => {
                send("boost_config_preset", { action: "delete", name });
            });
        }
    }

    function refreshStatus() {
        const status = CustomNetTables.GetTableValue("boost_setup", "status");
        if (status) label("StatusLabel", root).text = status.message;
    }

    // ---- Buttons ----

    root.FindChildTraverse("SaveButton")!.SetPanelEvent("onactivate", () => {
        send("boost_config_preset", { action: "save", name: presetName() });
    });
    root.FindChildTraverse("ResetButton")!.SetPanelEvent("onactivate", () => {
        send("boost_config_reset", {});
    });
    root.FindChildTraverse("StartButton")!.SetPanelEvent("onactivate", () => {
        if (!isHost()) return;
        Game.AutoAssignPlayersToTeams(); // players who did not pick a team are put in one
        send("boost_config_start", {});
    });

    // ---- Start ----

    // Presets do not work yet and Valve's own picker starts the game, so these stay hidden for now
    for (const id of ["PresetsTitle", "PresetSave", "PresetList", "StartButton", "StatusLabel"]) root.FindChildTraverse(id)!.visible = false;


    // Net table listeners of this copy, removed when a newer copy replaces it
    const listeners: NetTableListenerID[] = [];

    // Keep the screen until the host presses Start Game
    Game.SetAutoLaunchEnabled(false);

    let lastState = -1;
    /** Seconds between "everyone has loaded" and the menu sliding in */
    const SLIDE_DELAY = 1;
    let slideScheduled = false;

    /** Every human player (bots have no Steam id) is connected, so everyone has loaded in. */
    function humansLoaded(): boolean {
        const ids = Game.GetAllPlayerIDs();
        let humans = 0;
        for (const id of ids) {
            const info = Game.GetPlayerInfo(id);
            if (!info || info.player_steamid === "0") continue;
            humans++;
            if (info.player_connection_state !== DOTAConnectionState_t.DOTA_CONNECTION_STATE_CONNECTED) return false;
        }
        return humans > 0;
    }

    // Show the overlay to everyone (read-only for all but the host), and only while the game is in the setup phase.
    // This panel is the overlay itself (created in manifest.ts), so hiding it frees the clicks underneath.
    function updateVisibility() {
        // A newer copy of the overlay replaced this one (manifest.ts deletes the old panel): stop this copy
        if (!root.IsValid()) {
            for (const listener of listeners) CustomNetTables.UnsubscribeNetTableListener(listener);
            return;
        }
        // Everyone sees the menu during setup; only the host can change it (the server checks this again). While players
        // are still loading, Valve's screen shows alone; the menu slides in from the left once the game reaches custom
        // game setup, which Dota only does when every player has loaded (G7)
        const state = Game.GetState();
        if (state !== lastState) {
            lastState = state;
            $.Msg(`[setup] game state ${state}, humans loaded: ${humansLoaded()}`);
        }
        root.visible = state <= DOTA_GameState.DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP;
        // Also once every human player is connected: bots never "load", which can keep the game in the loading state.
        // The class is added a moment later: added on the very first check, the panel was never drawn off screen, so
        // it just appeared without sliding (user 2026-09-30)
        const ready = state === DOTA_GameState.DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP || humansLoaded();
        if (ready && !slideScheduled) {
            slideScheduled = true;
            $.Schedule(SLIDE_DELAY, () => {
                if (root.IsValid()) root.AddClass("SlidIn");
            });
        }
        root.hittest = false;
        // Host privileges can arrive after the menu was drawn: switch the controls when that happens
        const shouldBeReadOnly = !isHost();
        if (shouldBeReadOnly !== readOnly) {
            readOnly = shouldBeReadOnly;
            root.SetHasClass("ReadOnly", readOnly);
            root.FindChildTraverse("ResetButton")!.visible = !readOnly;
            label("SetupHelp", root).text = readOnly
                ? "Only the host can change these settings. You see them update live."
                : "Click a tab to open its settings, type a value and press Enter.";
            for (const item of items) updateRow(item);
        }
        $.Schedule(0.5, updateVisibility);
    }
    updateVisibility();
    GameEvents.Subscribe("boost_setup_guest", event => {
        viewAsGuest = event.on === 1;
    });

    listeners.push(
        CustomNetTables.SubscribeNetTableListener("boost_config", refreshConfig),
        CustomNetTables.SubscribeNetTableListener("boost_presets", refreshPresets),
        CustomNetTables.SubscribeNetTableListener("boost_setup", refreshStatus),
    );
    refreshConfig();
    refreshPresets();
    refreshStatus();

    $.Msg("Game setup screen loaded");
})();
