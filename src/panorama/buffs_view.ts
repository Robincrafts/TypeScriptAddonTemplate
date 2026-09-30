// Everyone's buffs (G1, user 2026-09-30): a panel at the top left, under Dota's K/D/A readout, opened with its hero
// icon button. A click outside it closes it: anywhere in the game world (mouse callback), or on the BUFF tab or
// honey log button (hud.ts togglePanel).
// Every hero on the left (Radiant, then Dire: portrait, player name, number of buffed stats); the selected hero's
// buffed stats on the right, with only the number each stat has now (user: no before/after, no history), and MAX when
// the stat is at its final limit. Data: net table boost_summary (buff_summary.ts), one key per player.
// Runs in the same panel as hud.ts and uses its helpers (localPlayer, toArray, rowLabel, capitalize).

const buffsRoot = $("#BuffsViewRoot");

const INNATE_ICON = "s2r://panorama/images/hud/facets/innate_icon_large_png.vtex";

/** The hero whose buffs are shown on the right; your own at first */
let selectedPlayer: PlayerID = localPlayer;

function ToggleBuffsView() {
    buffsRoot.ToggleClass("Open");
    renderBuffsView();
}

function summaryOf(playerId: PlayerID): HeroBuffSummary | undefined {
    return CustomNetTables.GetTableValue("boost_summary", String(playerId)) as unknown as HeroBuffSummary | undefined;
}

function heroNameOf(playerId: PlayerID): string {
    return summaryOf(playerId)?.hero ?? Players.GetPlayerSelectedHero(playerId);
}

function buffsOf(playerId: PlayerID): BoughtBuff[] {
    return toArray(summaryOf(playerId)?.buffs as unknown as Record<number, BoughtBuff>);
}

/** One hero on the left: portrait, player name and how many stats are buffed. Click: show its buffs on the right. */
function addHeroEntry(list: Panel, playerId: PlayerID) {
    const heroName = heroNameOf(playerId);
    const entry = $.CreatePanel("Button", list, "");
    entry.AddClass("BuffsHeroEntry");
    entry.SetHasClass("Selected", playerId === selectedPlayer);
    entry.SetHasClass("IsLocalPlayer", playerId === localPlayer);
    entry.SetPanelEvent("onactivate", () => {
        selectedPlayer = playerId;
        renderBuffsView();
    });
    const portrait = $.CreatePanel("Image", entry, "") as ImagePanel;
    portrait.AddClass("BuffsHeroIcon");
    if (heroName) portrait.SetImage(`s2r://panorama/images/heroes/icons/${heroName}_png.vtex`);
    const name = $.CreatePanel("Label", entry, "");
    name.AddClass("BuffsHeroName");
    name.text = Players.GetPlayerName(playerId) || $.Localize(`#${heroName}`);
    const count = $.CreatePanel("Label", entry, "");
    count.AddClass("BuffsHeroCount");
    count.text = String(buffsOf(playerId).length);
}

/** One buffed stat on the right: skill icon, stat name, its number now, MAX at the final limit. */
function addBuffLine(list: Panel, buff: BoughtBuff) {
    const line = $.CreatePanel("Panel", list, "");
    line.AddClass("BuffLine");
    if (buff.innate) {
        const icon = $.CreatePanel("Image", line, "") as ImagePanel;
        icon.AddClass("BuffLineIcon");
        icon.SetImage(INNATE_ICON);
    } else {
        const icon = $.CreatePanel("DOTAAbilityImage", line, "") as AbilityImage;
        icon.AddClass("BuffLineIcon");
        icon.abilityname = buff.ability;
    }
    const stat = $.CreatePanel("Label", line, "");
    stat.AddClass("BuffLineStat");
    stat.text = capitalize(rowLabel(buff as unknown as RowView));
    const value = $.CreatePanel("Label", line, "");
    value.AddClass("BuffLineValue");
    value.text = buff.now;
    if (buff.max) {
        const max = $.CreatePanel("Label", line, "");
        max.AddClass("BuffLineMax");
        max.text = "MAX";
    }
}

/** Redraws the hero list and the selected hero's buffs (only while the view is open). */
function renderBuffsView() {
    if (!buffsRoot.BHasClass("Open")) return;
    const teams: [string, DOTATeam_t][] = [
        ["RadiantHeroes", DOTATeam_t.DOTA_TEAM_GOODGUYS],
        ["DireHeroes", DOTATeam_t.DOTA_TEAM_BADGUYS],
    ];
    for (const [id, team] of teams) {
        const list = buffsRoot.FindChildTraverse(id)!;
        list.RemoveAndDeleteChildren();
        for (const playerId of Game.GetPlayerIDsOnTeam(team)) addHeroEntry(list, playerId);
    }

    const heroName = heroNameOf(selectedPlayer);
    const title = buffsRoot.FindChildTraverse("BuffsDetailTitle") as LabelPanel;
    title.text = heroName ? $.Localize(`#${heroName}`).toUpperCase() : "";
    const list = buffsRoot.FindChildTraverse("BuffsDetailList")!;
    list.RemoveAndDeleteChildren();
    const buffs = buffsOf(selectedPlayer);
    if (buffs.length === 0) {
        const empty = $.CreatePanel("Label", list, "");
        empty.AddClass("BuffsEmpty");
        empty.text = "No buffs yet";
        return;
    }
    for (const buff of buffs) addBuffLine(list, buff);
}

CustomNetTables.SubscribeNetTableListener("boost_summary", renderBuffsView);

/** Whether the mouse is over the open view's box (button included). All in screen pixels. */
function cursorOverBuffsView(): boolean {
    const [x, y] = GameUI.GetCursorPosition();
    for (const box of [buffsRoot.FindChildTraverse("BuffsView"), buffsRoot.FindChildTraverse("BuffsViewButton")]) {
        if (!box) continue;
        const at = box.GetPositionWithinWindow();
        if (x >= at.x && x <= at.x + box.actuallayoutwidth && y >= at.y && y <= at.y + box.actuallayoutheight) return true;
    }
    return false;
}

// A click outside the open view closes it. This callback also gets clicks on the view's empty space (hittest did not
// stop them, user 2026-09-30), so those are checked by position: inside, the view stays open and the click is
// swallowed (true: the hero does not walk there); outside, it closes and the click does its normal job (false).
GameUI.SetMouseCallback(event => {
    if (event !== "pressed" || !buffsRoot.BHasClass("Open")) return false;
    if (cursorOverBuffsView()) return true;
    buffsRoot.RemoveClass("Open");
    return false;
});
