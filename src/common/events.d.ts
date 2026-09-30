/**
 * This file contains types for the events you want to send between the UI (Panorama)
 * and the server (VScripts).
 *
 * IMPORTANT:
 *
 * The dota engine will change the type of event data slightly when it is sent, so on the
 * Panorama side your event handlers will have to handle NetworkedData<EventType>, changes are:
 *   - Booleans are turned to 0 | 1
 *   - Arrays are automatically translated to objects when sending them as event. You have
 *     to change them back into arrays yourself!
 */

// To declare an event for use, add it to this table with the type of its data
interface CustomGameEventDeclarations {
    /** UI -> server: the player clicked a row of the Modify list */
    boost_buy_upgrade: BuyUpgradeEventData;

    /** Setup menu -> server (host only): change one setting */
    boost_config_set: ConfigSetEventData;
    /** Setup menu -> server (host only): save, load or delete a preset file entry */
    boost_config_preset: ConfigPresetEventData;
    /** Setup menu -> server (host only): back to the default settings */
    boost_config_reset: {};
    /** Setup menu -> server (host only): close the menu and go on to hero selection */
    boost_config_start: {};

    /** Server -> UI: an item was sold away from shops; the UI plays Dota's sell sound (server-sent sounds stayed silent) */
    boost_item_sold: {};

    /**
     * Server -> UI (boost_audit_every, tools mode): "ability|value" keys joined by ";". The UI prints Dota's tooltip
     * label for each as "[tooltip] ability|value|label" (Lua cannot read tooltips; scripts/gen_tooltips.js reads them
     * from console.log)
     */
    boost_localize_request: { keys: string };
    /** Server -> clients (debug command boost_setup_guest): show the setup menu as a non-host sees it, read-only */
    boost_setup_guest: { on: number };
}

interface BuyUpgradeEventData {
    /** UpgradeOption id, e.g. "lina_light_strike_array:cooldown" */
    optionId: string;
    /** 1 = click (number up), -1 = Alt+click (number down) */
    direction: 1 | -1;
}

interface ConfigSetEventData {
    /** A key of GameConfig */
    key: string;
    value: number;
}

interface ConfigPresetEventData {
    action: "save" | "load" | "delete";
    name: string;
}
