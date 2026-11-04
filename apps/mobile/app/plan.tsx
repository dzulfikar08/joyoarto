// Plan & simulate (the web's routes/plan.tsx): the baseline from the ledger, up to six scenarios built from templates
// (car loan, small car then bigger, baby) and items (loans with sale terms, one-offs, monthly costs, income changes),
// each simulated with a verdict, compared side by side with the month-by-month projection, and saved for the
// household (plan.scenarios). The page itself is a draft kept on this phone (src/lib/plan-draft.ts).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { useMe } from "@/components/data";
import { BaselineCard } from "@/components/plan/baseline-card";
import { CompareView } from "@/components/plan/compare-view";
import { ChoiceField } from "@/components/plan/fields";
import { ScenarioCard } from "@/components/plan/scenario-card";
import { Button, Card, ErrorState, ListRow, Screen, SkeletonCard, Text } from "@/components/ui";
import { errorMessage } from "@/src/lib/errors";
import { currentMonthWib, shiftMonth } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { loadPlanDraft, savePlanDraft } from "@/src/lib/plan-draft";
import {
  addScenario,
  blankStart,
  compareInput,
  duplicateNames,
  duplicateScenario,
  EMPTY_PLAN,
  HORIZONS,
  markDeleted,
  markSaved,
  MAX_SCENARIOS,
  nameOf,
  openSaved,
  quickStart,
  removeScenario,
  savePayload,
  updateScenario,
  upgradeStart,
  type PlanState,
  type Scenario,
} from "@/src/lib/plan-state";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const HORIZON_OPTIONS = HORIZONS.map((m) => [String(m), `${m} months`] as const);
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The draft for the active household: loaded once, written a moment after each change. */
function usePlanDraft(householdId: string | undefined) {
  const [state, setState] = useState<PlanState | null>(null);
  const loadedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    // No household known (an old stored session before /me answers): an empty page that is not kept.
    if (!householdId) return setState((s) => s ?? EMPTY_PLAN);
    if (loadedFor.current === householdId) return;
    loadedFor.current = householdId;
    setState(null);
    void loadPlanDraft(householdId).then(setState);
  }, [householdId]);
  useEffect(() => {
    if (state && householdId && loadedFor.current === householdId) savePlanDraft(householdId, state);
  }, [state, householdId]);
  return [state, setState] as const;
}

export default function PlanScreen() {
  const me = useMe();
  const qc = useQueryClient();
  const [draft, setDraft] = usePlanDraft(me?.household.id);
  const state = draft ?? EMPTY_PLAN;
  const update = (fn: (s: PlanState) => PlanState) => setDraft((s) => fn(s ?? EMPTY_PLAN));
  const start = shiftMonth(currentMonthWib(), 1);

  const baseline = useQuery(orpc.plan.baseline.queryOptions({ input: {} }));
  const saved = useQuery(orpc.plan.scenarios.list.queryOptions());
  const input = useMemo(() => compareInput(state), [state]);
  const debounced = useDebounced(input, 400);
  const compare = useQuery({
    ...orpc.plan.compare.queryOptions({ input: debounced ?? { scenarios: [{ name: "-", items: [] }] } }),
    enabled: baseline.isSuccess && !!debounced && !!draft,
    placeholderData: keepPreviousData,
  });

  const refreshSaved = () => void qc.invalidateQueries({ queryKey: orpc.plan.scenarios.key() });

  const save = useMutation({
    mutationFn: (s: Scenario) => client.plan.scenarios.save(savePayload(state, s) as Parameters<typeof client.plan.scenarios.save>[0]),
    onSuccess: (r, s) => {
      update((st) => markSaved(st, s.id, r.scenario));
      refreshSaved();
      toast.success(r.created ? `Saved "${r.scenario.name}"` : `Updated "${r.scenario.name}"`, "Everyone in your household can open it.");
    },
    onError: (e) => toast.error("Couldn't save", errorMessage(e, { storeSafe })),
  });

  const onSave = (s: Scenario) => {
    const name = nameOf(s);
    const clash = saved.data?.scenarios.find((x) => x.name === name && x.id !== s.savedId);
    if (clash && !s.savedId) {
      Alert.alert("Replace the saved scenario?", `A saved scenario is already called "${name}". Replace it?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: () => save.mutate(s) },
      ]);
      return;
    }
    save.mutate(s);
  };

  const remove = useMutation({
    mutationFn: (id: string) => client.plan.scenarios.delete({ id }),
    onSuccess: (r) => {
      update((st) => markDeleted(st, r.id));
      refreshSaved();
    },
    onError: (e) => toast.error("Couldn't delete", errorMessage(e, { storeSafe })),
  });

  const [opening, setOpening] = useState<string | null>(null);
  const open = async (id: string) => {
    setOpening(id);
    try {
      const sc = await client.plan.scenarios.get({ id });
      const r = openSaved(state, { id: sc.id, name: sc.name, plan: sc.plan as Parameters<typeof openSaved>[1]["plan"], view: sc.view });
      if (!r.ok) return toast.error(r.reason);
      setDraft(r.state);
      if (r.keptPageBaseline) toast.show("Kept this page's baseline numbers", { description: `"${sc.name}" was saved with its own; every scenario here uses the same baseline.` });
    } catch (e) {
      toast.error(errorMessage(e, { storeSafe }));
    } finally {
      setOpening(null);
    }
  };

  const openIds = new Set(state.scenarios.map((s) => s.savedId).filter((x): x is string => !!x));
  const dupes = duplicateNames(state.scenarios);
  const refreshing = baseline.isRefetching || saved.isRefetching;

  if (!draft || (baseline.isPending && !baseline.data)) {
    return (
      <Screen>
        <Text tone="muted">Reading your ledger…</Text>
        <SkeletonCard lines={5} />
        <SkeletonCard lines={3} />
      </Screen>
    );
  }

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        void baseline.refetch();
        void saved.refetch();
      }}
    >
      <Text tone="muted">Try a car, a baby or any big change against your real income, spending and savings.</Text>

      {baseline.data ? <BaselineCard b={baseline.data} state={state} update={update} /> : null}
      {baseline.isError ? <ErrorState compact={!!baseline.data} error={baseline.error} onRetry={() => void baseline.refetch()} /> : null}

      {saved.data?.scenarios.length ? (
        <Card title="Saved scenarios" subtitle="Shared with your household. Open one to compare it with what is on this page." padded>
          {saved.data.scenarios.map((s) => {
            const by = s.updatedBy?.name ?? s.createdBy?.name;
            const onPage = openIds.has(s.id);
            return (
              <ListRow
                key={s.id}
                title={s.name}
                numberOfLines={2}
                subtitle={`${s.labels.length ? s.labels.join(" · ") : "No change"} — ${dateFmt.format(new Date(s.updatedAt))}${by ? ` by ${by}` : ""}`}
                right={
                  <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                    {onPage ? (
                      <Text variant="caption" tone="muted">
                        On this page
                      </Text>
                    ) : (
                      <Button title="Open" small variant="secondary" loading={opening === s.id} onPress={() => void open(s.id)} />
                    )}
                    <Button
                      title="Delete"
                      small
                      variant="ghost"
                      accessibilityLabel={`Delete the saved scenario "${s.name}"`}
                      onPress={() =>
                        Alert.alert("Delete this saved scenario?", `"${s.name}" is removed for everyone in your household.`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => remove.mutate(s.id) },
                        ])
                      }
                    />
                  </View>
                }
              />
            );
          })}
        </Card>
      ) : null}
      {saved.isError && !saved.data ? <ErrorState compact error={saved.error} onRetry={() => void saved.refetch()} /> : null}

      <View style={styles.sectionHead}>
        <Text variant="heading" accessibilityRole="header">
          Scenarios
        </Text>
        <View style={{ width: 150 }}>
          <ChoiceField label="Look ahead" value={String(state.horizonMonths)} options={HORIZON_OPTIONS} onChange={(v) => update((s) => ({ ...s, horizonMonths: Number(v) }))} />
        </View>
      </View>

      {!state.scenarios.length ? (
        <Card>
          <Text>Start with an example: two car options and a baby in six months, against not buying a car. Then fill in the real prices and the dealer's rate.</Text>
          <Button title="Car A vs Car B vs no car, with a baby" onPress={() => update((s) => ({ ...s, scenarios: quickStart(start) }))} />
          <Button title="Small car now, bigger car later" variant="secondary" onPress={() => update((s) => ({ ...s, scenarios: upgradeStart(start) }))} />
          <Button title="Blank scenario" variant="ghost" onPress={() => update((s) => ({ ...s, scenarios: blankStart() }))} />
        </Card>
      ) : null}

      {state.scenarios.map((s) => (
        <ScenarioCard
          key={s.id}
          s={s}
          start={start}
          result={dupes.includes(nameOf(s)) ? undefined : compare.data?.scenarios.find((r) => r.name === nameOf(s))}
          onChange={(fn) => update((st) => updateScenario(st, s.id, fn))}
          onSave={() => onSave(s)}
          saving={save.isPending && save.variables?.id === s.id}
          onRemove={() => update((st) => removeScenario(st, s.id))}
          onDuplicate={() => update((st) => duplicateScenario(st, s.id))}
          canDuplicate={state.scenarios.length < MAX_SCENARIOS}
        />
      ))}
      {state.scenarios.length > 0 && state.scenarios.length < MAX_SCENARIOS ? <Button title="Add scenario" icon="add" variant="secondary" onPress={() => update(addScenario)} /> : null}

      {dupes.length ? (
        <Card tone="warning">
          <Text tone="warning">Two scenarios are called "{dupes[0]}". Give each its own name to see its results.</Text>
        </Card>
      ) : null}
      {compare.isError ? <ErrorState compact error={compare.error} onRetry={() => void compare.refetch()} /> : null}
      {compare.data && state.scenarios.length > 0 ? (
        <View style={{ gap: 12, opacity: compare.isPlaceholderData || compare.isFetching ? 0.7 : 1 }}>
          <CompareView c={compare.data} scenarios={state.scenarios} />
        </View>
      ) : compare.isFetching && state.scenarios.length > 0 ? (
        <SkeletonCard lines={4} height={200} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create(() => ({
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
}));
