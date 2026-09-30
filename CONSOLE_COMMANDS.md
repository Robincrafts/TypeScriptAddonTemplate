# Dota Boosted: console commands

**Most commands only work in tools mode** (Workshop Tools, `npm run launch`). In a published match they do
nothing, so no player can use them to cheat. The **Information** commands only print text, so they work
everywhere, including normal Dota (`-console`) and published matches.

Open the console with the `` ` `` key.
Every command acts on **your own hero**. `<ability>` is the internal ability name, e.g. `pudge_meat_hook`;
use `boost_show` to see your hero's ability names.

## Information

| Command | What it does |
|---|---|
| `boost_status` | Team sizes, game time, your gold and level |
| `boost_modifiers` | Prints your hero's facet id, Scepter item charges, every ability slot (hidden ones too, with level and behavior flags) and every modifier (with its ability and stack count), e.g. to find how the game marks a chosen Scepter option. In tools mode the console also logs every uncommon order as `[order] type N ...` |
| `boost_show` | Lists your abilities and their active boosts |
| `boost_audit` | Every stat of your hero that can be modified: base value, stat type, size of one common click, and where it stops now and late game |
| `boost_audit <hero>` | The same for any hero, e.g. `boost_audit pudge`, even if nobody picked it |
| `boost_audit all` | The same for every hero in the match (bots included) |
| `boost_audit_every` | Tools mode only: every hero in Dota, Scepter/Shard stats included, printed with an `[audit]` tag. Your UI also prints Dota's tooltip label of every value (`[tooltip]` lines), which `node scripts/gen_tooltips.js` turns into `tooltip_data.ts`. With `npm run launch` the console is saved to `dota 2 beta/game/dota/console.log` |
| `boost_valueinfo <ability> <value>` | How Dota computes one value: base, Scepter/Shard/talent bonus, our buff |
| `boost_options <ability>` | What the scanner found to modify on one ability |
| `boost_list <ability>` | All value names of one ability (for `boost_value`) |
| `boost_points` | Your points, the cost of the next modification, total earned |

## Hero testing

| Command | What it does |
|---|---|
| `boost_level <levels>` | Levels up your hero; you spend the skill points yourself |
| `boost_autoskill` | Spends all your skill points automatically |
| `boost_refresh` | Full health and mana, resets all cooldowns |
| `boost_kill` | Kills your hero (to test respawn times) |
| `boost_herokill <me\|enemy> [count]` | Real hero kills: `me` = you kill the first enemy hero, `enemy` = it kills you (respawns the victim between kills). Counts on the scoreboard, for kill gold, streaks and points. Tests the kill limit |
| `boost_spawn_ward <observer\|sentry>` | Spawns an enemy ward next to your hero, so you can attack it to test dewarding |
| `boost_setup_guest` | Toggles the setup menu between the host's view and the read-only view the other players get (in tools mode you are always the host). Use during game setup |

## Points and gold

| Command | What it does |
|---|---|
| `boost_givepoints <amount>` | Gives yourself points |
| `boost_givegold <amount>` | Gives yourself gold |
| `boost_pointrate <number>` | Multiplies all point gains (1 = normal); same as the menu's points multiplier |

## Modifying skills directly

These bypass the MODIFY panel, its costs and its limits.

| Command | What it does |
|---|---|
| `boost_botbuffs [count] [max]` | Gives every bot hero `count` free random buffs (default 5, random rarities, every third one lowered), to fill the everyone's-buffs view; with `max` each bot also gets one stat pushed to its current cap, e.g. `boost_botbuffs 8 max` |
| `boost_max <ability> [value name]` | Pushes one stat (or every stat) of an ability straight to its current cap, e.g. `boost_max pudge_meat_hook damage`; no value name maxes the whole ability |
| `boost_value <ability> <value name> <multiplier>` | Multiplies one ability value, e.g. `boost_value pudge_meat_hook damage 2` |
| `boost_cooldown <ability> <multiplier>` | Cooldown multiplier (0.5 = half the cooldown) |
| `boost_casttime <ability> <multiplier>` | Cast point multiplier (0.5 = half the cast point) |
| `boost_mana <ability> <multiplier>` | Mana cost multiplier (0.5 = half the mana cost) |
| `boost_range <ability> <bonus>` | Flat cast range bonus, e.g. `boost_range pudge_meat_hook 300` |
| `boost_reset [ability]` | Removes the boosts of one ability, or of all abilities without an argument |

## Old text-based upgrade flow (from before the MODIFY panel)

| Command | What it does |
|---|---|
| `boost_buy` | Spends points and offers 3 random upgrades |
| `boost_roll` | Offers 3 random upgrades without spending points |
| `boost_pick <1-3>` | Takes one of the offered upgrades |
| `boost_random [count]` | Applies random upgrades (default 1) |
