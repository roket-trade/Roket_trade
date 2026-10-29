import { supabase } from "@/integrations/supabase/client";

/**
 * Canonical plan ladder. A plan's position in this list is its rank, so
 * "Plan 3" ranks 3 and only "Plan 4" is a legal upgrade from it.
 */
export const PLAN_NAMES = ["Plan 1", "Plan 2", "Plan 3", "Plan 4"] as const;

export const HIGHEST_PLAN_RANK = PLAN_NAMES.length;

/** Rank a stored plan name ("Plan 3" → 3). Unknown / empty names rank null. */
export function planIndex(planName: string | null | undefined): number | null {
  const match = /plan\s*-?\s*(\d+)/i.exec((planName ?? "").trim());
  if (!match) return null;

  const rank = Number(match[1]);
  if (!Number.isInteger(rank) || rank < 1 || rank > HIGHEST_PLAN_RANK) return null;
  return rank;
}

/**
 * The signed-in user's current plan rank, read from `profiles.plan_name`.
 *
 * Returns null ("no restriction") when there is no user, no row, or the lookup
 * fails — a failed read must never lock a paying user out of an upgrade.
 */
export async function fetchCurrentPlanIndex(
  userId: string | null | undefined,
): Promise<number | null> {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("plan_name")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("[plans] plan_name lookup failed:", error);
      return null;
    }

    return planIndex((data as { plan_name?: string | null } | null)?.plan_name);
  } catch (err) {
    console.error("[plans] plan_name lookup threw:", err);
    return null;
  }
}

/**
 * True when `target` is a real upgrade. An unknown current plan (signed out or
 * no plan yet) allows every plan; otherwise the target must be strictly higher.
 */
export function isPlanUpgrade(current: number | null, target: number): boolean {
  return current === null || target > current;
}

/** Short label for a blocked plan: the same plan, or a downgrade. */
export function blockedPlanLabel(
  current: number | null,
  target: number,
): "Current Plan" | "Upgrade Required" {
  return current === target ? "Current Plan" : "Upgrade Required";
}
