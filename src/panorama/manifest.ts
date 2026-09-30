// Puts the game settings on top of Valve's own team picker. The overlay is created on the very top
// panel of the game window, so it shows during the setup phase, before the normal HUD exists.
let top: Panel = $.GetContextPanel();
while (top.GetParent()) top = top.GetParent()!;

// The UI scripts can run again (UI reload, alt-tab, file changes in tools mode). Remove the overlay an earlier run made,
// or copies stack on top of each other, each with its own tab selected.
for (const child of top.Children()) {
    if (child.id === "BoostSetupOverlay") {
        child.visible = false;
        child.DeleteAsync(0);
    }
}

const overlay = $.CreatePanel("Panel", top, "BoostSetupOverlay");
overlay.SetHasClass("BoostSetupOverlay", true);
overlay.style.height = "100%";
overlay.style.horizontalAlign = "left";
overlay.BLoadLayout("file://{resources}/layout/custom_game/game_setup.xml", false, false);

// Hero selection: the enemy team's heroes stay hidden until the strategy time (user 2026-09-30, like ranked All Pick).
// Valve's pick screen shows each player as a DOTAHudHeroPickingPlayer along the top (#RadiantTeamPlayers /
// #DireTeamPlayers). An enemy card keeps looking unpicked (the empty slate card Dota shows before a pick) with the
// player's name; the
// hero name and facet stay hidden too. Checked often, since Valve's HUD may rebuild the cards at any time.
//
// On every card (both teams) the pulsing pick bar (#HeroImagePickBar) shows only while that player is still picking:
// once they have locked in a hero it goes away, so the enemy team can see who has picked, as in ranked. Valve kept it
// pulsing on bots that picked at the start (user 2026-09-30).
const HIDDEN_PARTS = ["HeroImage", "HeroName", "FacetIcon"];
let reportedEnemySlots = false;

function pickSlots(parent: Panel, found: Panel[] = []): Panel[] {
    for (const child of parent.Children()) {
        if (child.paneltype === "DOTAHudHeroPickingPlayer") found.push(child);
        else pickSlots(child, found);
    }
    return found;
}

function hideEnemySlot(slot: Panel) {
    for (const id of HIDDEN_PARTS) {
        const part = slot.FindChildTraverse(id);
        if (part) part.style.opacity = "0";
    }
    const container = slot.FindChildTraverse("HeroImageContainer") ?? slot;
    if (container.FindChildTraverse("BoostHiddenPick")) return;
    // Valve's #HeroImage without a hero: its own background, size and offset (dota_hud_hero_picking_player.vcss_c)
    const empty = $.CreatePanel("Panel", container, "BoostHiddenPick");
    empty.hittest = false;
    empty.style.backgroundColor = "gradient( radial, 50% 90%, 0% 0%, 80% 90%, from( #444D5A ), to( #161B23 ) )";
    empty.style.width = "118px";
    empty.style.height = "width-percentage( 56.25% )";
    empty.style.transform = "translateY(6px) translateX(-1px)";
}

/** Whether the card's player has locked in a hero (HeroPickNone: nothing yet; HeroPickTentative: only hovering). */
function hasPicked(slot: Panel): boolean {
    return !slot.BHasClass("HeroPickNone") && !slot.BHasClass("HeroPickTentative");
}

/** The pulsing pick bar only while the player is still picking; null hands it back to Valve's styling. */
function updatePickBar(slot: Panel, picking: boolean) {
    const bar = slot.FindChildTraverse("HeroImagePickBar");
    if (bar) (bar.style as any).visibility = picking && hasPicked(slot) ? "collapse" : null;
}

function showSlot(slot: Panel) {
    for (const id of HIDDEN_PARTS) {
        const part = slot.FindChildTraverse(id);
        // Back to Valve's own styling (forcing opacity 1 showed the hero name over the player name)
        if (part) (part.style as any).opacity = null;
    }
    slot.FindChildTraverse("BoostHiddenPick")?.DeleteAsync(0);
}

function hideEnemyPicks() {
    const state = Game.GetState();
    const picking = state === DOTA_GameState.DOTA_GAMERULES_STATE_HERO_SELECTION;
    const localTeam = Players.GetTeam(Players.GetLocalPlayer());
    const enemyId = localTeam === DOTATeam_t.DOTA_TEAM_BADGUYS ? "RadiantTeamPlayers" : "DireTeamPlayers";
    const enemy = top.FindChildTraverse(enemyId);
    const slots = enemy ? pickSlots(enemy) : [];
    for (const slot of slots) {
        if (picking) hideEnemySlot(slot);
        else showSlot(slot);
    }
    for (const id of ["RadiantTeamPlayers", "DireTeamPlayers"]) {
        const team = top.FindChildTraverse(id);
        if (team) for (const slot of pickSlots(team)) updatePickBar(slot, picking);
    }
    if (picking && !reportedEnemySlots) {
        reportedEnemySlots = true;
        $.Msg(`[pick] hiding enemy picks: #${enemyId} ${enemy ? "found" : "NOT found"}, ${slots.length} slots`);
    }
    // Keep watching until hero selection is over (then the slots were shown again above)
    if (state <= DOTA_GameState.DOTA_GAMERULES_STATE_HERO_SELECTION) $.Schedule(0.1, hideEnemyPicks);
}
hideEnemyPicks();

$.Msg("ui manifest loaded");
