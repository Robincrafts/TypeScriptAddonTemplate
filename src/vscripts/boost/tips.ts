// Short how-to lines in the chat when the game starts. Dota fades chat lines out by itself after a few seconds.
import { config } from "./config";

const TIP_SECONDS = 3.5;

export function showTips() {
    const tips = [
        "Earn honey points by playing and getting kills. Spend them in the BUFF panel at the top right.",
        "Click a row to buff it up. Hold Alt and click to tone it down.",
        "Row colors show rarity: grey, blue, purple, gold. Rarer buffs are bigger.",
        config.startingUpgrades > 0
            ? `You start with ${config.startingUpgrades} free buffs. Good luck!`
            : "Good luck!",
    ];
    tips.forEach((tip, index) => {
        Timers.CreateTimer(1 + index * TIP_SECONDS, () => {
            GameRules.SendCustomMessage(tip, 0, 0);
        });
    });
}
