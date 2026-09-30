import { BaseModifier, registerModifier } from "../lib/dota_ts_adapter";
import { getAbilityBoost, ORB_COUNTS, setOrbCount } from "../boost/boost_store";
import { config } from "../boost/config";
import { getTimesModified, roundStat } from "../boost/upgrade_engine";
import { isCountValue } from "../boost/skill_rules";

/**
 * Permanent hidden modifier on every hero. Reads the hero's boosts from the net table and applies them
 * to abilities: ability values, cooldown, cast point, mana cost and cast range.
 * Runs on both server and client, so tooltips match what the server actually does.
 */
@registerModifier(undefined, "modifiers/modifier_boost")
export class modifier_boost extends BaseModifier {
    IsHidden(): boolean {
        return true;
    }

    IsPurgable(): boolean {
        return false;
    }

    RemoveOnDeath(): boolean {
        return false;
    }

    GetAttributes(): ModifierAttribute {
        return ModifierAttribute.PERMANENT;
    }

    DeclareFunctions(): ModifierFunction[] {
        return [
            ModifierFunction.OVERRIDE_ABILITY_SPECIAL,
            ModifierFunction.OVERRIDE_ABILITY_SPECIAL_VALUE,
            ModifierFunction.COOLDOWN_PERCENTAGE,
            ModifierFunction.CASTTIME_PERCENTAGE,
            ModifierFunction.MANACOST_PERCENTAGE,
            ModifierFunction.CAST_RANGE_BONUS,
            ModifierFunction.ON_ABILITY_FULLY_CAST,
            ModifierFunction.EXTRA_HEALTH_BONUS,
            ModifierFunction.PHYSICAL_ARMOR_BONUS,
            ModifierFunction.HEALTH_REGEN_CONSTANT,
            ModifierFunction.ATTACKSPEED_BONUS_CONSTANT,
            ModifierFunction.MOVESPEED_BONUS_PERCENTAGE,
            ModifierFunction.PREATTACK_BONUS_DAMAGE,
        ];
    }

    // --- Invoker's orbs ---
    // The engine computes the per-orb bonuses (Quas regen, Wex speeds, Exort damage) without asking our value override,
    // so a buff on them did nothing (user 2026-09-30: GetSpecialValueFor showed 1.6 but regen stayed). The difference
    // our buff makes per orb is added here, times the number of orbs of that kind. Only the server can count the orb
    // modifiers; it publishes the counts (setOrbCount) so the clients' HUD shows the same bonus.

    private hasOrbs?: boolean;
    private orbCache: Record<string, number> = {};
    private orbCacheAt = -1;

    /** How many orbs of this kind are up: counted on the server (and published), read from the net table on clients. */
    private orbCount(orb: string): number {
        const hero = this.GetParent();
        if (!IsServer()) return getAbilityBoost(hero, ORB_COUNTS)?.values?.[orb] ?? 0;
        const count = hero.FindAllModifiersByName(`modifier_invoker_${orb}_instance`).length;
        setOrbCount(hero, orb, count);
        return count;
    }

    /** Our buff's change to one orb's value (0 without a buff), times how many of those orbs are up. */
    private orbBonus(orb: "quas" | "wex" | "exort", valueName: string): number {
        // These hooks run constantly on every hero: everyone but Invoker leaves right away
        this.hasOrbs ??= this.GetParent().FindAbilityByName("invoker_quas") !== undefined;
        if (!this.hasOrbs) return 0;
        const now = IsServer() ? GameRules.GetGameTime() : Time();
        if (now !== this.orbCacheAt) {
            this.orbCache = {};
            this.orbCacheAt = now;
        }
        const key = `${orb}|${valueName}`;
        const cached = this.orbCache[key];
        if (cached !== undefined) return cached;

        let bonus = 0;
        const hero = this.GetParent();
        const ability = hero.FindAbilityByName(`invoker_${orb}`);
        if (ability !== undefined && ability.GetLevel() > 0 && this.boostOf(ability)?.adds?.[valueName] !== undefined) {
            const level = ability.GetLevel() - 1;
            const event = { ability, ability_special_value: valueName, ability_special_level: level } as ModifierOverrideAbilitySpecialEvent;
            const perOrb = this.GetModifierOverrideAbilitySpecialValue(event) - ability.GetLevelSpecialValueNoOverride(valueName, level);
            bonus = perOrb * this.orbCount(orb);
        }
        this.orbCache[key] = bonus;
        return bonus;
    }

    GetModifierConstantHealthRegen(): number {
        return this.orbBonus("quas", "hp_regen_per_instance");
    }

    GetModifierAttackSpeedBonus_Constant(): number {
        return this.orbBonus("wex", "attack_speed_per_instance");
    }

    GetModifierMoveSpeedBonus_Percentage(): number {
        return this.orbBonus("wex", "move_speed_per_instance");
    }

    GetModifierPreAttack_BonusDamage(): number {
        return this.orbBonus("exort", "bonus_damage_per_instance");
    }

    OnCreated(): void {
        // Tooltips are drawn from the client copy of this modifier; this line proves it runs
        if (!IsServer()) print(`[boost] client modifier active on ${this.GetParent().GetUnitName()}`);
    }

    /**
     * Hero growth: the stack count holds the game minutes (the client sees it as well).
     * Server only, called every second by the game tick for every hero.
     */
    static updateGrowth(hero: CDOTA_BaseNPC) {
        const modifier = hero.FindModifierByName(modifier_boost.name);
        if (modifier === undefined) return;
        const minutes = math.max(math.floor(GameRules.GetDOTATime(false, false) / 60), 0);
        if (modifier.GetStackCount() !== minutes) modifier.SetStackCount(minutes);
    }

    private clientConfig: any;
    private clientConfigReadAt?: number;

    /**
     * A host setting; the client has no config object, so it reads the published copy. Cached for a second:
     * health and armor are asked for constantly and every net table read builds a new table.
     */
    private setting(key: "healthFlatPerMinute" | "healthGrowthMax" | "armorPer5Minutes" | "teleportCooldown"): number {
        if (IsServer()) return config[key];
        const now = Time();
        if (this.clientConfigReadAt === undefined || now - this.clientConfigReadAt >= 1) {
            this.clientConfig = CustomNetTables.GetTableValue("boost_config", "values");
            this.clientConfigReadAt = now;
        }
        return this.clientConfig?.[key] ?? 0;
    }

    GetModifierExtraHealthBonus(): number {
        return math.min(this.setting("healthFlatPerMinute") * this.GetStackCount(), this.setting("healthGrowthMax"));
    }

    GetModifierPhysicalArmorBonus(): number {
        return this.setting("armorPer5Minutes") * math.floor(this.GetStackCount() / 5);
    }

    /**
     * Random cooldown (host setting): right after a modified skill is cast, its cooldown is stretched or
     * shrunk by a random amount that grows with how often the skill was modified (4% per modification, at most 50%).
     */
    OnAbilityFullyCast(event: ModifierAbilityEvent): void {
        if (!IsServer() || config.randomCooldown !== 1) return;
        if (event.unit !== this.GetParent()) return;

        const times = getTimesModified(this.GetParent(), event.ability.GetAbilityName());
        const remaining = event.ability.GetCooldownTimeRemaining();
        if (times <= 0 || remaining <= 0) return;

        const spread = math.min(0.04 * times, 0.5);
        event.ability.EndCooldown();
        event.ability.StartCooldown(remaining * RandomFloat(1 - spread, 1 + spread));
    }

    private boostOf(ability: CDOTABaseAbility | undefined): AbilityBoost | undefined {
        if (ability === undefined) return undefined;
        return getAbilityBoost(this.GetParent(), ability.GetAbilityName());
    }

    // Ability values (damage, radius, duration, ...): first ask "do you override this?", then "to what?"
    GetModifierOverrideAbilitySpecial(event: ModifierOverrideAbilitySpecialEvent): 0 | 1 {
        const boost = this.boostOf(event.ability);
        const name = event.ability_special_value;
        return boost?.values?.[name] !== undefined || boost?.adds?.[name] !== undefined ? 1 : 0;
    }

    GetModifierOverrideAbilitySpecialValue(event: ModifierOverrideAbilitySpecialEvent): number {
        const boost = this.boostOf(event.ability);
        const name = event.ability_special_value;
        const base = event.ability.GetLevelSpecialValueNoOverride(name, event.ability_special_level);
        // A value that is 0 at this level (a Scepter value without the Scepter) stays 0
        if (base === 0) return 0;
        // Buffs add the same amount at every level; linked values (vision, reach) are multiplied.
        const scaled = base * (boost?.values?.[name] ?? 1);
        let value = scaled + (boost?.adds?.[name] ?? 0);
        // Limits compare sizes, since some stats are negative numbers (-30 incoming damage): a lowered value never
        // shrinks below its floor (a share of its normal number at this level), a raised one never passes its ceiling
        // (radius 1200, chance 60), unless the normal number is already bigger
        const floorSize = math.abs(scaled) * (boost?.floors?.[name] ?? 0.05);
        if (math.abs(value) < floorSize || value * scaled < 0) value = scaled < 0 ? -floorSize : floorSize;
        const max = boost?.maxes?.[name];
        if (max !== undefined) {
            const ceiling = math.max(max, math.abs(scaled));
            if (math.abs(value) > ceiling) value = value < 0 ? -ceiling : ceiling;
        }
        // Rounded the same way as the BUFF panel, so tooltips show clean numbers; counts are whole numbers
        return isCountValue(event.ability_special_value) ? math.floor(value + 0.5) : roundStat(value);
    }

    // The "percentage" properties return a percent REDUCTION: multiplier 0.5 -> 50, multiplier 1.5 -> -50.
    GetModifierPercentageCooldown(event: ModifierAbilityEvent): number {
        if (event.ability?.GetAbilityName() === "item_tpscroll") return this.teleportReduction(event.ability);
        return this.percentReduction(this.boostOf(event.ability)?.cooldown);
    }

    /** Host setting "Teleport Scroll cooldown": the reduction that brings Dota's cooldown down to it. */
    private teleportReduction(item: CDOTABaseAbility): number {
        const wanted = this.setting("teleportCooldown");
        // Items on the client have no GetCooldown (Script Runtime Error): read the number from the item's KV there
        const anyItem = item as any;
        const base: number =
            anyItem.GetCooldown !== undefined
                ? item.GetCooldown(item.GetLevel())
                : tonumber(anyItem.GetAbilityKeyValues?.()?.AbilityCooldown) ?? 0;
        if (wanted <= 0 || base <= wanted) return 0;
        return this.percentReduction(wanted / base);
    }

    GetModifierPercentageCasttime(event: ModifierAbilityEvent): number {
        return this.percentReduction(this.boostOf(event.ability)?.casttime);
    }

    GetModifierPercentageManacost(event: ModifierAbilityEvent): number {
        return this.percentReduction(this.boostOf(event.ability)?.manacost);
    }

    GetModifierCastRangeBonus(event: ModifierAbilityEvent): number {
        return this.boostOf(event.ability)?.castrange ?? 0;
    }

    private percentReduction(multiplier: number | undefined): number {
        return multiplier === undefined ? 0 : (1 - multiplier) * 100;
    }
}
