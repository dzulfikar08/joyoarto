// One scenario: its name, verdict, and the blocks it adds to the baseline (car loans with sale terms, a baby, one-off
// costs, monthly costs, income changes, spending cuts), with Save / Duplicate / Remove. The web's ScenarioCard and editors.

import { defaultResalePct } from "@baroka/api/lib/plan/resale";
import { babyTemplate, carTemplate } from "@baroka/api/lib/plan/templates";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Disclosure, Icon, IconButton, Input, Pill, SwitchRow, Text } from "@/components/ui";
import { monthLabel, shiftMonth } from "@/src/lib/format";
import {
  addBlocks,
  babyBlock,
  carBlock,
  downPaymentHint,
  downPaymentPctHint,
  FUNDED,
  isDirty,
  isHabitCut,
  itemWhen,
  newCut,
  newIncomeChange,
  newOneOff,
  newRecurring,
  nextCarLabel,
  patchSale,
  regenerateBaby,
  removeBlock,
  saveLabel,
  setBlock,
  setDownPayment,
  setDownPaymentPct,
  setInstallment,
  setResalePct,
  shiftBaby,
  signedAmount,
  tenorChoices,
  toggleSale,
  upgradeBlocks,
  VERDICT,
  type BabyBlock,
  type Block,
  type LoanIn,
  type PlainIn,
  type Scenario,
  type ScenarioItemInput,
  type VerdictKind,
} from "@/src/lib/plan-state";
import type { AppRouterClient, Out } from "@/src/lib/rpc";

import { rp } from "./baseline-card";
import { Cell, ChoiceField, FieldGrid, MoneyField, MonthField, NumField } from "./fields";

export type Compare = Out<AppRouterClient["plan"]["compare"]>;
export type CompareScenario = Compare["scenarios"][number];
type LoanTerms = CompareScenario["loans"][number];
type SaleOut = NonNullable<LoanTerms["sale"]>;

const monthYear = (m: string) => `${monthLabel(m, "short")} ${m.slice(0, 4)}`;
const RATE_TYPES = [
  ["flat", "Flat"],
  ["effective", "Effective"],
] as const;
const DIRECTIONS = [
  ["out", "Money out"],
  ["in", "Money in"],
] as const;
const MODES = [
  ["delta", "Add / remove"],
  ["replace", "Income becomes"],
] as const;

type Funded = (typeof FUNDED)[number][0];
const funded = (v: string | undefined): Funded => (v === "spending" || v === "emergency" ? v : "goal");

export function VerdictBadge({ v }: { v: VerdictKind }) {
  const x = VERDICT[v];
  return <Pill label={x.label} tone={x.tone} icon={x.icon} />;
}

export function SlotDot({ slot }: { slot: number }) {
  const { theme } = useUnistyles();
  return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.viz.series[(slot - 1) % theme.viz.series.length] }} />;
}

export function ScenarioCard({
  s,
  start,
  result,
  onChange,
  onSave,
  saving,
  onRemove,
  onDuplicate,
  canDuplicate,
}: {
  s: Scenario;
  start: string;
  result?: CompareScenario;
  onChange: (fn: (s: Scenario) => Scenario) => void;
  onSave: () => void;
  saving: boolean;
  onRemove: () => void;
  onDuplicate: () => void;
  canDuplicate: boolean;
}) {
  const dirty = isDirty(s);
  let loanIndex = 0;
  const add = (...b: Block[]) => onChange((x) => addBlocks(x, ...b));
  return (
    <Card>
      <View style={styles.titleRow}>
        <SlotDot slot={s.slot} />
        <Input style={styles.name} value={s.name} onChangeText={(name) => onChange((x) => ({ ...x, name }))} accessibilityLabel="Scenario name" maxLength={60} />
        {result ? <VerdictBadge v={result.verdict} /> : null}
      </View>
      {s.savedId ? (
        <Text variant="caption" tone="muted">
          {dirty ? "Saved scenario · unsaved changes" : "Saved scenario"}
        </Text>
      ) : null}
      {s.blocks.length === 0 ? <Text tone="muted">Nothing added yet: this is the same as no change.</Text> : null}
      {s.blocks.map((b) => {
        if (b.kind === "loan") {
          const terms = result?.loans[loanIndex++];
          return <LoanEditor key={b.key} item={b.item} terms={terms} onChange={(item) => onChange((x) => setBlock(x, b.key, { ...b, item }))} onRemove={() => onChange((x) => removeBlock(x, b.key))} />;
        }
        if (b.kind === "baby") return <BabyEditor key={b.key} b={b} onChange={(nb) => onChange((x) => setBlock(x, b.key, nb))} onRemove={() => onChange((x) => removeBlock(x, b.key))} />;
        return <ItemEditor key={b.key} item={b.item} onChange={(item) => onChange((x) => setBlock(x, b.key, { ...b, item }))} onRemove={() => onChange((x) => removeBlock(x, b.key))} />;
      })}
      <View style={styles.adds}>
        <AddChip label="Car loan" onPress={() => add(carBlock(start, nextCarLabel(s)))} />
        <AddChip label="Small car, then bigger" onPress={() => add(...upgradeBlocks(start))} />
        <AddChip label="Baby" onPress={() => add(babyBlock(shiftMonth(start, 6)))} />
        <AddChip label="One-off" onPress={() => add(newOneOff(start))} />
        <AddChip label="Monthly cost" onPress={() => add(newRecurring(start))} />
        <AddChip label="Income change" onPress={() => add(newIncomeChange(start))} />
        <AddChip label="Spending cut" onPress={() => add(newCut(start))} />
      </View>
      <View style={styles.actions}>
        <Button title={saving ? "Saving…" : saveLabel(s)} icon={s.savedId && !dirty ? "checkmark" : "cloud-upload-outline"} small variant="secondary" loading={saving} disabled={!!s.savedId && !dirty} onPress={onSave} />
        <Button title="Duplicate" small variant="ghost" disabled={!canDuplicate} onPress={onDuplicate} />
        <Button title="Remove" small variant="destructive" onPress={onRemove} />
      </View>
    </Card>
  );
}

function AddChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Add ${label}`} onPress={onPress} style={({ pressed }) => [styles.addChip, pressed && { opacity: 0.7 }]}>
      <Text variant="caption" tone="primary" style={styles.addText}>
        + {label}
      </Text>
    </Pressable>
  );
}

function BlockShell({ title, onRemove, children }: { title: ReactNode; onRemove: () => void; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <View style={{ flex: 1 }}>{title}</View>
        <IconButton name="close" label="Remove" tone="muted" size={20} onPress={onRemove} />
      </View>
      {children}
    </View>
  );
}

function Toggle({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress} style={styles.toggle} hitSlop={6}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={14} tone="muted" />
    </Pressable>
  );
}

function Terms({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <View style={styles.terms}>
      {rows.map(([k, v, strong]) => (
        <View key={k} style={styles.term}>
          <Text variant="caption" tone="muted">
            {k}
          </Text>
          <Text variant="caption" style={[styles.num, strong && styles.strong]}>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LoanEditor({ item, terms, onChange, onRemove }: { item: LoanIn; terms?: LoanTerms; onChange: (i: LoanIn) => void; onRemove: () => void }) {
  const [costs, setCosts] = useState(false);
  const set = (patch: Partial<LoanIn>) => onChange({ ...item, ...patch });
  const estimates = carTemplate({ month: "2000-01" }).estimates;
  const dpHint = downPaymentHint(item);
  const pctHint = downPaymentPctHint(item);
  return (
    <BlockShell onRemove={onRemove} title={<Input style={styles.blockName} value={item.label ?? ""} onChangeText={(label) => set({ label })} accessibilityLabel="Loan name" maxLength={80} />}>
      <FieldGrid>
        <Cell label="OTR price">
          <MoneyField label="Price" value={item.price || undefined} placeholder="from the dealer" onChange={(v) => set({ price: v ?? 0 })} />
        </Cell>
        <Cell label="Buy in">
          <MonthField label="Purchase month" value={item.month} onChange={(v) => v && set({ month: v })} />
        </Cell>
        <Cell label="Down payment %" hint={item.downPayment !== undefined ? "From the amount" : null}>
          <NumField
            label="Down payment percent"
            value={item.downPayment !== undefined ? undefined : item.downPaymentPct}
            placeholder={pctHint !== undefined ? String(pctHint).replace(".", ",") : undefined}
            max={100}
            onChange={(v) => onChange(setDownPaymentPct(item, v))}
          />
        </Cell>
        <Cell label="Down payment">
          <MoneyField label="Down payment" value={item.downPayment} placeholder={dpHint !== undefined ? rp(dpHint).replace("Rp ", "") : undefined} onChange={(v) => onChange(setDownPayment(item, v))} />
        </Cell>
        <Cell label="Tenor (months)">
          <ChoiceField label="Tenor" value={String(item.tenorMonths)} options={tenorChoices(item.tenorMonths).map((m) => [String(m), `${m} months`] as const)} onChange={(v) => set({ tenorMonths: Number(v) })} />
        </Cell>
        <Cell label="Rate % / year" hint={item.installment !== undefined ? "Not used: installment quoted" : "Ask the dealer"}>
          <NumField label="Interest rate" value={item.ratePct} max={60} optional disabled={item.installment !== undefined} onChange={(v) => set({ ratePct: v ?? 0 })} />
        </Cell>
        <Cell label="Installment (quoted)" hint="Optional: the dealer's figure">
          <MoneyField label="Quoted installment" value={item.installment} placeholder="from the rate" onChange={(v) => onChange(setInstallment(item, v))} />
        </Cell>
        <Cell label="Rate type">
          <ChoiceField label="Rate type" value={item.rateType ?? "flat"} options={RATE_TYPES} onChange={(rateType) => set({ rateType })} />
        </Cell>
        <Cell label="DP paid from" wide>
          <ChoiceField label="Down payment paid from" value={funded(item.fundedFrom)} options={FUNDED} onChange={(fundedFrom) => set({ fundedFrom })} />
        </Cell>
      </FieldGrid>

      <Toggle label="Insurance, fees and running costs (estimates)" open={costs} onPress={() => setCosts(!costs)} />
      {costs ? (
        <View style={{ gap: 10 }}>
          <FieldGrid>
            <Cell label="Insurance yr 1 (% of price)">
              <NumField label="Insurance first year percent" value={item.insuranceFirstYearPct} max={100} onChange={(v) => set({ insuranceFirstYearPct: v, insuranceFirstYear: undefined })} />
            </Cell>
            <Cell label="Insurance later (%/yr)">
              <NumField label="Insurance renewal percent" value={item.insuranceRenewalPct} max={100} onChange={(v) => set({ insuranceRenewalPct: v })} />
            </Cell>
            <Cell label="Admin fee">
              <MoneyField label="Admin fee" value={item.adminFee} onChange={(v) => set({ adminFee: v ?? 0 })} />
            </Cell>
            <Cell label="Provision %">
              <NumField label="Provision percent" value={item.provisionPct} max={100} onChange={(v) => set({ provisionPct: v })} />
            </Cell>
            <Cell label="PKB (%/yr of price)">
              <NumField label="Vehicle tax percent" value={item.annualTaxPct} max={100} onChange={(v) => set({ annualTaxPct: v, annualTax: undefined })} />
            </Cell>
            <Cell label="Fuel / month">
              <MoneyField label="Fuel" value={item.fuelMonthly} onChange={(v) => set({ fuelMonthly: v ?? 0 })} />
            </Cell>
            <Cell label="Parking & toll / month">
              <MoneyField label="Parking and toll" value={item.parkingTollMonthly} onChange={(v) => set({ parkingTollMonthly: v ?? 0 })} />
            </Cell>
            <Cell label="Maintenance / month">
              <MoneyField label="Maintenance" value={item.maintenanceMonthly} onChange={(v) => set({ maintenanceMonthly: v ?? 0 })} />
            </Cell>
            <Cell label="Saves / month" hint="Grab, taxis it replaces">
              <MoneyField label="Saves monthly" value={item.savesMonthly} onChange={(v) => set({ savesMonthly: v ?? 0 })} />
            </Cell>
          </FieldGrid>
          <SwitchRow label="Insurance in the loan" value={!!item.insuranceFinanced} onValueChange={(v) => set({ insuranceFinanced: v })} />
          <SwitchRow label="Fees in the loan" value={!!item.feesFinanced} onValueChange={(v) => set({ feesFinanced: v })} />
          <SwitchRow label="First installment upfront (ADDM)" value={item.payment === "advance"} onValueChange={(v) => set({ payment: v ? "advance" : "arrears" })} />
          {estimates.map((e) => (
            <Text key={e} variant="caption" tone="muted">
              • {e}
            </Text>
          ))}
        </View>
      ) : null}

      <SaleEditor item={item} sale={terms?.sale ?? null} onChange={onChange} />

      {terms && item.price > 0 ? (
        <Terms
          rows={[
            ["Installment", terms.installment.display, true],
            ["Cash upfront", terms.upfront.display],
            ["Total interest", terms.totalInterest.display],
            [`Cost over ${terms.tenorMonths} mo`, terms.totalCostOfOwnership.display],
            ...(item.rateType !== "effective" || item.installment !== undefined ? ([["Effective rate ≈", `${terms.effectiveRatePct}% / yr`]] as [string, string][]) : []),
          ]}
        />
      ) : null}
      {!item.price ? (
        <Text variant="caption" tone="warning">
          Enter the price to see the installment.
        </Text>
      ) : null}
    </BlockShell>
  );
}

/** "Sell it after N months": the sale price first settles the loan, the rest comes back. */
function SaleEditor({ item, sale, onChange }: { item: LoanIn; sale: SaleOut | null; onChange: (i: LoanIn) => void }) {
  const s = item.sale;
  const after = s?.afterMonths ?? 18;
  return (
    <View style={{ gap: 8 }}>
      <SwitchRow label="Sell it later (upgrade path)" value={!!s} onValueChange={(v) => onChange(toggleSale(item, v))} />
      {s ? (
        <>
          <FieldGrid>
            <Cell label="Sell after (months)" hint={item.month ? `In ${monthYear(shiftMonth(item.month, after))}` : null}>
              <NumField label="Sell after months" integer value={s.afterMonths} min={1} max={120} onChange={(v) => onChange(patchSale(item, { afterMonths: Math.max(1, v ?? 1) }))} />
            </Cell>
            <Cell label="Resale % of price" hint={s.resalePct === undefined && s.resaleAmount === undefined ? "EV estimate" : null}>
              <NumField label="Resale percent" optional max={100} value={s.resalePct} placeholder={String(defaultResalePct(after))} onChange={(v) => onChange(setResalePct(item, v))} />
            </Cell>
            <Cell label="Early-settlement fee %" hint="Of the loan left">
              <NumField label="Settlement penalty percent" max={100} value={s.settlementPenaltyPct} onChange={(v) => onChange(patchSale(item, { settlementPenaltyPct: v }))} />
            </Cell>
            <Cell label="Proceeds go to">
              <ChoiceField label="Sale proceeds go to" value={funded(s.proceedsTo)} options={FUNDED} onChange={(proceedsTo) => onChange(patchSale(item, { proceedsTo }))} />
            </Cell>
          </FieldGrid>
          {sale ? (
            <Terms
              rows={[
                [`Sold ${monthYear(sale.month)} for`, `${sale.resale.display} (${sale.resalePct}%)`],
                ["Loan left to settle", sale.settlement.display],
                [sale.net.amount >= 0 ? "Cash back" : "To pay", sale.net.display.replace("-", ""), true],
                [`Cost over ${sale.afterMonths} mo`, sale.costWhileOwned.display],
              ]}
            />
          ) : null}
          <Text variant="caption" tone="muted">Add the next car as another loan bought in the sale month.</Text>
          <Disclosure plain title="About the resale estimate">
            Default resale: battery EVs in Indonesia lose about 35% in the first year and 10% a year after; ask for a trade-in quote.
          </Disclosure>
        </>
      ) : null}
    </View>
  );
}

function BabyEditor({ b, onChange, onRemove }: { b: BabyBlock; onChange: (b: BabyBlock) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const setItem = (i: number, item: ScenarioItemInput) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? item : x)) });
  return (
    <BlockShell onRemove={onRemove} title={<Text variant="label">Baby</Text>}>
      <Cell label="Expected birth" wide>
        <MonthField label="Birth month" value={b.birthMonth} onChange={(v) => v && onChange(shiftBaby(b, v))} />
      </Cell>
      <SwitchRow label="Caesarean" value={b.caesar} onValueChange={(v) => onChange(regenerateBaby(b, v, b.caregiver))} />
      <SwitchRow label="Caregiver / nanny" value={b.caregiver} onValueChange={(v) => onChange(regenerateBaby(b, b.caesar, v))} />
      <Toggle label={`${b.items.length} costs (estimates you can edit)`} open={open} onPress={() => setOpen(!open)} />
      {open ? (
        <View style={{ gap: 10 }}>
          {b.items.map((it, i) => (
            <View key={i} style={styles.babyRow}>
              <View style={{ flex: 1 }}>
                <Text variant="caption">{it.label}</Text>
                <Text variant="caption" tone="muted">
                  {itemWhen(it, rp)}
                </Text>
              </View>
              <View style={{ width: 140 }}>
                {it.type === "oneOff" ? <MoneyField label={it.label ?? "Amount"} value={it.amount} onChange={(v) => setItem(i, { ...it, amount: v ?? 0 })} /> : null}
                {it.type === "recurring" ? <MoneyField label={it.label ?? "Monthly"} value={it.monthly} onChange={(v) => setItem(i, { ...it, monthly: v ?? 0 })} /> : null}
              </View>
            </View>
          ))}
          {babyTemplate({ birthMonth: b.birthMonth }).estimates.map((e) => (
            <Text key={e} variant="caption" tone="muted">
              • {e}
            </Text>
          ))}
        </View>
      ) : null}
    </BlockShell>
  );
}

function ItemEditor({ item, onChange, onRemove }: { item: PlainIn; onChange: (i: PlainIn) => void; onRemove: () => void }) {
  // The sign the ± button shows; kept here too so "−" chosen before typing (amount 0) sticks.
  const [negativeWhileZero, setNegative] = useState(item.type === "incomeChange" && item.amount < 0);
  const negative = item.type === "incomeChange" && item.amount !== 0 ? item.amount < 0 : negativeWhileZero;
  const title = <Input style={styles.blockName} value={item.label} onChangeText={(label) => onChange({ ...item, label })} accessibilityLabel="Name" maxLength={80} />;
  if (item.type === "oneOff") {
    return (
      <BlockShell onRemove={onRemove} title={title}>
        <FieldGrid>
          <Cell label="Amount">
            <MoneyField label="Amount" value={item.amount || undefined} onChange={(v) => onChange({ ...item, amount: v ?? 0 })} />
          </Cell>
          <Cell label="Month">
            <MonthField label="Month" value={item.month} onChange={(v) => v && onChange({ ...item, month: v })} />
          </Cell>
          <Cell label="Direction">
            <ChoiceField label="Direction" value={item.direction ?? "out"} options={DIRECTIONS} onChange={(direction) => onChange({ ...item, direction })} />
          </Cell>
          <Cell label={item.direction === "in" ? "Goes to" : "Paid from"}>
            <ChoiceField label={item.direction === "in" ? "Goes to" : "Paid from"} value={funded(item.fundedFrom)} options={FUNDED} onChange={(fundedFrom) => onChange({ ...item, fundedFrom })} />
          </Cell>
        </FieldGrid>
      </BlockShell>
    );
  }
  if (item.type === "recurring") {
    return (
      <BlockShell onRemove={onRemove} title={title}>
        <FieldGrid>
          <Cell label="Per month">
            <MoneyField label="Monthly amount" value={item.monthly || undefined} onChange={(v) => onChange({ ...item, monthly: v ?? 0 })} />
          </Cell>
          <Cell label="Increase %/yr">
            <NumField label="Yearly increase" value={item.annualIncreasePct} max={100} onChange={(v) => onChange({ ...item, annualIncreasePct: v })} />
          </Cell>
          <Cell label="From">
            <MonthField label="Start month" value={item.startMonth} onChange={(v) => v && onChange({ ...item, startMonth: v })} />
          </Cell>
          <Cell label="Until (optional)">
            <MonthField optional label="End month" value={item.endMonth} onChange={(v) => onChange({ ...item, endMonth: v })} />
          </Cell>
        </FieldGrid>
      </BlockShell>
    );
  }
  if (item.type === "cut") {
    return (
      <BlockShell onRemove={onRemove} title={title}>
        <FieldGrid>
          <Cell label="Less spending / month" wide>
            <MoneyField label="Monthly saving" value={item.monthly || undefined} onChange={(v) => onChange({ ...item, monthly: v ?? 0 })} />
          </Cell>
          <Cell label="From">
            <MonthField label="Start month" value={item.startMonth} onChange={(v) => v && onChange({ ...item, startMonth: v })} />
          </Cell>
          <Cell label="Until (optional)">
            <MonthField optional label="End month" value={item.endMonth} onChange={(v) => onChange({ ...item, endMonth: v })} />
          </Cell>
        </FieldGrid>
        {isHabitCut(item) ? (
          <Text variant="caption" tone="muted">
            From Where to save: change the target there and add it again to update.
          </Text>
        ) : null}
      </BlockShell>
    );
  }
  return (
    <BlockShell onRemove={onRemove} title={title}>
      <FieldGrid>
        <Cell label="Change" wide>
          <ChoiceField label="Change" value={item.mode ?? "delta"} options={MODES} onChange={(mode) => onChange({ ...item, mode })} />
        </Cell>
        <Cell label={item.mode === "replace" ? "New income / month" : "Per month (− to reduce)"} wide>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {item.mode !== "replace" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={negative ? "Reduces income. Tap to add instead" : "Adds income. Tap to reduce instead"}
                onPress={() => {
                  setNegative(!negative);
                  if (item.amount) onChange({ ...item, amount: -item.amount });
                }}
                style={styles.sign}
              >
                <Text variant="heading">{negative ? "−" : "+"}</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>
              <MoneyField label="Amount" value={Math.abs(item.amount) || undefined} onChange={(v) => onChange({ ...item, amount: signedAmount(v, item.mode !== "replace" && negative) })} />
            </View>
          </View>
        </Cell>
        <Cell label="From">
          <MonthField label="Start month" value={item.startMonth} onChange={(v) => v && onChange({ ...item, startMonth: v })} />
        </Cell>
        <Cell label="Until (optional)">
          <MonthField optional label="End month" value={item.endMonth} onChange={(v) => onChange({ ...item, endMonth: v })} />
        </Cell>
      </FieldGrid>
    </BlockShell>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, minHeight: 44, paddingVertical: 8, fontFamily: theme.fonts.bold },
  adds: { flexDirection: "row", flexWrap: "wrap", gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 12, marginTop: 4 },
  addChip: { borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.primary, borderRadius: theme.radius.pill, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  addText: { fontFamily: theme.fonts.bold },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  block: { backgroundColor: theme.colors.muted, borderRadius: theme.radius.tile, padding: 12, gap: 10 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  blockName: { minHeight: 44, paddingVertical: 8, fontFamily: theme.fonts.bold },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36 },
  terms: { flexDirection: "row", flexWrap: "wrap", rowGap: 8, backgroundColor: theme.colors.card, borderRadius: theme.radius.tile, padding: 10 },
  term: { width: "50%", gap: 1, paddingRight: 6 },
  num: { fontVariant: ["tabular-nums"] },
  strong: { fontFamily: theme.fonts.bold },
  babyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sign: { width: 48, minHeight: 48, borderRadius: theme.radius.input, backgroundColor: theme.colors.primarySoft, alignItems: "center", justifyContent: "center" },
}));
