// Ends the match early: when a team reaches the kill limit, or when the time limit runs out.
// Both come from the setup menu (0 = off). Kills are the team scores on the scoreboard. The winner of a time limit is
// the team with more kills, and with equal kills the team with more total net worth.
import { config } from "./config";

let ended = false;

function teamName(team: DotaTeam): string {
    return team === DotaTeam.GOODGUYS ? "Radiant" : "Dire";
}

function say(message: string) {
    GameRules.SendCustomMessage(message, 0, 0);
}

function finish(winner: DotaTeam, reason: string) {
    if (ended) return;
    ended = true;
    print(`[game end] ${reason} winner: ${teamName(winner)}`);
    say(`${reason} ${teamName(winner)} wins!`);
    GameRules.SetGameWinner(winner);
}

function netWorth(team: DotaTeam): number {
    let total = 0;
    for (let playerId = 0 as PlayerID; playerId < DOTA_MAX_PLAYERS; playerId++) {
        if (PlayerResource.IsValidPlayerID(playerId) && PlayerResource.GetTeam(playerId) === team) {
            total += PlayerResource.GetNetWorth(playerId);
        }
    }
    return total;
}

/** A team's kills as the scoreboard counts them. */
function kills(team: DotaTeam): number {
    return PlayerResource.GetTeamKills(team);
}

function timeUp() {
    const radiant = kills(DotaTeam.GOODGUYS);
    const dire = kills(DotaTeam.BADGUYS);
    let winner: DotaTeam;
    if (radiant !== dire) winner = radiant > dire ? DotaTeam.GOODGUYS : DotaTeam.BADGUYS;
    else winner = netWorth(DotaTeam.GOODGUYS) >= netWorth(DotaTeam.BADGUYS) ? DotaTeam.GOODGUYS : DotaTeam.BADGUYS;
    finish(winner, `Time is up (${radiant} - ${dire} kills).`);
}

let warned = false;

/** Called every second by the game tick once the horn has sounded: kill limit and time limit. */
export function checkGameEnd() {
    if (ended) return;

    if (config.killLimit > 0) {
        const radiant = kills(DotaTeam.GOODGUYS);
        const dire = kills(DotaTeam.BADGUYS);
        // Both over the limit in the same second (a double kill): the team with more kills wins
        if (radiant >= config.killLimit || dire >= config.killLimit) {
            finish(radiant >= dire ? DotaTeam.GOODGUYS : DotaTeam.BADGUYS, `Kill limit reached (${radiant} - ${dire}).`);
            return;
        }
    }

    if (config.timeLimit <= 0) return;
    const left = config.timeLimit * 60 - GameRules.GetDOTATime(false, false);
    if (left <= 0) {
        timeUp();
    } else if (left <= 60 && !warned) {
        warned = true;
        say("One minute left! The team with more kills wins.");
    }
}
