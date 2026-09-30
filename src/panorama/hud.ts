// "Modify" panel, top right. The server publishes two net tables per player:
//   boost_points  - points and the cost of the next upgrade
//   boost_options - the random boostables currently offered (host setting, 3 to 8), each with a rarity
// Every row has an increase (▲) and a decrease (▼) button, each showing the number it would give; the player decides
// which way helps (user 2026-09-30). Either costs one upgrade.
// The list is only shown while the player has an upgrade to spend.
// This script only shows the data and sends which row was clicked; the server does the checking.

interface RowView {
    id: string;
    ability: string;
    label: string;
    rarity: string;
    power: number;
    canUp: number | boolean;
    canDown: number | boolean;
    value: string;
    upValue: string;
    downValue: string;
    exactValue: number;
    upExact: number;
    downExact: number;
    innate?: number | boolean;
}

const localPlayer = Players.GetLocalPlayer();
const panel = $("#ModifyPanel");
const list = $("#ModifyList");

let credits = 0; // how many upgrades the player can afford right now
let hoveredId = "";
let hoveredDirection: 1 | -1 = 1;
let signature = "";
const views: Record<string, RowView> = {};
const rows: Record<string, Panel> = {};

/** Net tables turn arrays into objects keyed 1, 2, 3...; this turns them back. */
function toArray<T>(obj: Record<number, T> | T[] | undefined | null): T[] {
    const result: T[] = [];
    if (!obj) return result;

    let key = 1;
    while ((obj as Record<number, T>)[key]) {
        result.push((obj as Record<number, T>)[key]);
        key++;
    }
    return result;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function label(id: string, parent: Panel): LabelPanel {
    return parent.FindChildTraverse(id) as LabelPanel;
}

/** Dota's tooltip text for an ability value ("%HEALTH DECAY:"), in the player's language, or undefined if it has none. */
function tooltipText(ability: string, valueName: string): string | undefined {
    const key = `DOTA_Tooltip_ability_${ability}_${valueName}`;
    const text = $.Localize(`#${key}`);
    if (!text || text === key || text === `#${key}`) return undefined;
    return text;
}

/** "%HEALTH DECAY:" -> "health decay"; "+$damage BONUS:" -> "damage bonus". */
function cleanTooltip(text: string): string {
    return text
        .replace(/^%/, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\$([A-Za-z_]+)/g, (_, word: string) => word.replace(/_/g, " "))
        .replace(/[+:：]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/**
 * The row's name: Dota's own tooltip label for skill values (Heartstopper's "aura_damage" is "Health decay" in the
 * tooltip), in the player's language; the server's label otherwise (cooldown, cast range...) or when Dota has none.
 * The server's "(Scepter)" / "(Shard)" marker is kept.
 */
function rowLabel(view: RowView): string {
    const [ability, kind, valueName] = view.id.split(":");
    if (kind !== "value" || !valueName) return view.label;
    const text = tooltipText(ability, valueName);
    const cleaned = text === undefined ? "" : cleanTooltip(text);
    if (cleaned === "") return view.label;
    const item = /\((Scepter|Shard)\)$/.exec(view.label);
    return item ? `${cleaned} (${item[1]})` : cleaned;
}

/**
 * The row's icon (A4). Innate skills show Dota's innate icon. Other skills are drawn from the hero's own ability entity,
 * so cosmetics that change a spell icon (arcanas, immortals) show the same icon as the hero's ability bar.
 */
function setIcon(row: Panel, view: RowView) {
    row.SetHasClass("Innate", !!view.innate);
    const icon = row.FindChildTraverse("RowIcon") as AbilityImage;
    const hero = Players.GetPlayerHeroEntityIndex(localPlayer);
    const ability = hero === -1 ? -1 : Entities.GetAbilityByName(hero, view.ability);
    if (ability !== -1) icon.contextEntityIndex = ability;
    else icon.abilityname = view.ability;
}

/** The classes of the two panels under the tabs: BUFF list and honey log. One open at a time. */
const PANEL_CLASSES = ["Open", "HoneyLogOpen"];

/** Opens the panel with this class and closes the others, or closes it when it was open. */
function togglePanel(className: string) {
    const opening = !panel.BHasClass(className);
    for (const other of PANEL_CLASSES) panel.RemoveClass(other);
    // A click here is a click outside the everyone's-buffs view (top left): it closes
    $("#BuffsViewRoot")?.RemoveClass("Open");
    if (opening) panel.AddClass(className);
}

/** Whether either panel is open. */
function anyPanelOpen(): boolean {
    return PANEL_CLASSES.some(className => panel.BHasClass(className));
}

/** The list can only be opened while there is something to spend. */
function ToggleModifyPanel() {
    if (credits > 0) togglePanel("Open");
}

/** Can this row's button in `direction` (1 = increase, -1 = decrease) be clicked right now? */
function isAllowed(view: RowView, direction: 1 | -1): boolean {
    return credits > 0 && !!(direction === 1 ? view.canUp : view.canDown);
}

function buy(id: string, direction: 1 | -1) {
    const view = views[id];
    if (!view || !isAllowed(view, direction)) return;
    GameEvents.SendCustomGameEventToServer("boost_buy_upgrade", { optionId: id, direction });
}

/** Up to 2 decimals, no trailing zeros: 0.25, 121.8, 1632 (user 2026-09-30: no long decimals). */
function exact(value: number): string {
    return String(Number(value.toFixed(2)));
}

function showInfo() {
    const view = views[hoveredId];
    if (!view) {
        label("InfoDetail", panel).text = "";
        return;
    }
    // The precise change of the button under the mouse
    const up = hoveredDirection === 1;
    const allowed = up ? view.canUp : view.canDown;
    const change = allowed
        ? `${exact(view.exactValue)} ${up ? "▲" : "▼"} ${exact(up ? view.upExact : view.downExact)}`
        : `${exact(view.exactValue)}, cannot go ${up ? "higher" : "lower"} yet`;
    label("InfoDetail", panel).text = `${capitalize(rowLabel(view))}: ${change}`;
}

/** The numbers and the dimming of every row depend on the credits and on each direction's limit. */
function updateRows() {
    for (const id in rows) {
        const view = views[id];
        const row = rows[id];
        label("RowValue", row).text = view.value;
        label("UpText", row).text = `▲ ${view.upValue}`;
        label("DownText", row).text = `▼ ${view.downValue}`;
        row.FindChildTraverse("UpButton")!.SetHasClass("Disabled", !isAllowed(view, 1));
        row.FindChildTraverse("DownButton")!.SetHasClass("Disabled", !isAllowed(view, -1));
        row.SetHasClass("Disabled", credits <= 0);
    }
    showInfo();
}

/** Opens or closes the honey log (the button left of the BUFF tab). It works even with nothing to spend. */
function ToggleHoneyLog() {
    togglePanel("HoneyLogOpen");
}

/** Game clock as m:ss */
function clock(seconds: number): string {
    const whole = Math.max(Math.floor(seconds), 0);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The honey log (A2): one line per recent honey gain, newest first: "+10   Creep   3:25". */
function showHoneyLog(events: HoneyEvent[]) {
    const list = panel.FindChildTraverse("HoneyLogList")!;
    list.RemoveAndDeleteChildren();
    if (events.length === 0) {
        const empty = $.CreatePanel("Label", list, "");
        empty.AddClass("HoneyEmpty");
        empty.text = "No honey earned yet. Kills, creeps, towers, runes and wards give honey.";
        return;
    }
    for (const event of events) {
        const line = $.CreatePanel("Panel", list, "");
        line.AddClass("HoneyLine");
        const amount = $.CreatePanel("Label", line, "");
        amount.AddClass("HoneyAmount");
        amount.text = `+${Number.isInteger(event.amount) ? event.amount : event.amount.toFixed(1)}`;
        const reason = $.CreatePanel("Label", line, "");
        reason.AddClass("HoneyReason");
        reason.text = capitalize(event.reason);
        const time = $.CreatePanel("Label", line, "");
        time.AddClass("HoneyTime");
        time.text = clock(event.time);
    }
}

function refreshPoints() {
    const info = CustomNetTables.GetTableValue("boost_points", String(localPlayer));
    if (!info) return;

    const before = credits;
    credits = Math.floor(info.points / info.cost);
    label("TabCount", panel).text = String(credits);

    // How far along the next buff is (after the ones already affordable)
    const progress = Math.min(Math.max((info.points - credits * info.cost) / info.cost, 0), 1);
    panel.FindChildTraverse("TabProgressFill")!.style.width = `${(progress * 100).toFixed(1)}%`;
    // The same progress as numbers, while the list is open (A1)
    const toward = Math.max(Math.floor(info.points - credits * info.cost), 0);
    label("NextBuff", panel).text = `Next buff: ${toward} / ${Math.floor(info.cost)}`;
    showHoneyLog(toArray(info.recent as unknown as Record<number, HoneyEvent>));
    panel.SetHasClass("HasCredits", credits > 0);

    if (credits > 0 && before === 0) {
        // Slide the list in by itself the moment the first upgrade becomes affordable, unless another panel is open
        // (only one at a time; the gold BUFF tab still shows there is something to spend)
        if (!anyPanelOpen()) panel.AddClass("Open");
    } else if (credits === 0) {
        // Nothing left to spend: the list slides out
        panel.RemoveClass("Open");
    }
    updateRows();
}

function refreshMenu() {
    const menu = CustomNetTables.GetTableValue("boost_options", String(localPlayer));
    if (!menu) return;

    const newRows = toArray(menu.rows as unknown as Record<number, RowView>);
    const newSignature = newRows.map(r => `${r.id}:${r.rarity}:${r.power}:${r.value}:${r.upValue}:${r.downValue}:${r.canUp}:${r.canDown}`).join("|");
    if (newSignature === signature) return;
    signature = newSignature;

    list.RemoveAndDeleteChildren();
    for (const id in rows) delete rows[id];
    for (const id in views) delete views[id];
    hoveredId = "";

    for (const view of newRows) {
        const row = $.CreatePanel("Panel", list, "");
        row.BLoadLayoutSnippet("ModifyRow");
        row.AddClass(`Rarity_${view.rarity}`);
        setIcon(row, view);
        label("RowStat", row).text = capitalize(rowLabel(view));

        for (const [buttonId, direction] of [["UpButton", 1], ["DownButton", -1]] as const) {
            const button = row.FindChildTraverse(buttonId)!;
            button.SetPanelEvent("onactivate", () => buy(view.id, direction));
            button.SetPanelEvent("onmouseover", () => {
                hoveredId = view.id;
                hoveredDirection = direction;
                showInfo();
            });
            button.SetPanelEvent("onmouseout", () => {
                hoveredId = "";
                showInfo();
            });
        }

        views[view.id] = view;
        rows[view.id] = row;
    }
    updateRows();
}

// The honey log is a testing aid only: its button exists in tools mode, not in the published game (user 2026-09-30)
panel.FindChildTraverse("HoneyLogButton")!.visible = Game.IsInToolsMode();

CustomNetTables.SubscribeNetTableListener("boost_points", refreshPoints);
CustomNetTables.SubscribeNetTableListener("boost_options", refreshMenu);
// Selling away from shops (shop.ts): Dota's own sell sound, played here because server-sent sounds stayed silent
GameEvents.Subscribe("boost_item_sold", () => Game.EmitSound("General.Sell"));
// boost_audit_every: print Dota's tooltip text for every audited value, for scripts/gen_tooltips.js (Lua cannot read
// tooltips). The raw text is printed, "%" included: it marks values Dota shows as a percentage.
GameEvents.Subscribe("boost_localize_request", event => {
    for (const pair of event.keys.split(";")) {
        const [ability, valueName] = pair.split("|");
        if (!ability || !valueName) continue;
        const text = tooltipText(ability, valueName);
        if (text !== undefined) $.Msg(`[tooltip] ${ability}|${valueName}|${text.replace(/[\r\n]+/g, " ")}`);
    }
});
refreshPoints();
refreshMenu();

$.Msg("Modify panel loaded");
