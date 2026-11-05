import { View } from "react-native";

import { useAccountGroups, useCategoryGroups } from "@/components/data";
import { Button, DateField, FieldLabel, Picker, Pill, Row, Segmented, Sheet, SwitchRow } from "@/components/ui";
import { datePresets, EMPTY_FILTERS, presetOf, type Filters, type ReimburseFilter, type Status } from "@/src/lib/transaction-filters";

/** Account, category (or uncategorized), status and date range. Changes apply as they are made. */
export function FilterSheet({ open, onClose, filters, onChange }: { open: boolean; onClose: () => void; filters: Filters; onChange: (patch: Partial<Filters>) => void }) {
  const accounts = useAccountGroups();
  const categories = useCategoryGroups();
  const preset = presetOf(filters);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter transactions"
      footer={
        <Row>
          <Button title="Clear all" variant="secondary" onPress={() => onChange({ ...EMPTY_FILTERS, q: filters.q })} />
          <Button title="Show results" flex onPress={onClose} />
        </Row>
      }
    >
      <Picker label="Account" value={filters.accountId} groups={accounts} onChange={(v) => onChange({ accountId: v ?? "" })} none="All accounts" searchPlaceholder="Search accounts" />
      <SwitchRow label="Uncategorized only" value={filters.uncategorized} onValueChange={(v) => onChange({ uncategorized: v, ...(v ? { category: "" } : {}) })} />
      {!filters.uncategorized ? (
        <Picker label="Category" value={filters.category} groups={categories} onChange={(v) => onChange({ category: v ?? "" })} none="All categories" searchPlaceholder="Search categories" hint="Includes its subcategories" />
      ) : null}
      <FieldLabel label="Status">
        <Segmented<Status>
          label="Status"
          value={filters.status}
          onChange={(status) => onChange({ status })}
          options={[
            { value: "", label: "Any" },
            { value: "pending", label: "Pending" },
            { value: "posted", label: "Posted" },
          ]}
        />
      </FieldLabel>
      <FieldLabel label="Reimburse · Diganti kantor">
        <Segmented<ReimburseFilter>
          label="Reimburse"
          value={filters.reimburse}
          onChange={(reimburse) => onChange({ reimburse })}
          options={[
            { value: "", label: "All" },
            { value: "any", label: "Reimbursable" },
            { value: "open", label: "Open" },
            { value: "none", label: "Own" },
          ]}
        />
      </FieldLabel>
      <FieldLabel label="Dates">
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          {datePresets().map((p) => (
            <Pill key={p.key} label={p.label} selected={preset === p.key} onPress={() => onChange(preset === p.key ? { from: "", to: "" } : { from: p.from, to: p.to })} />
          ))}
        </Row>
      </FieldLabel>
      <Row gap={8}>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={filters.from} max={filters.to || undefined} clearable onChange={(from) => onChange({ from })} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="To" value={filters.to} min={filters.from || undefined} clearable placeholder="Today" onChange={(to) => onChange({ to })} />
        </View>
      </Row>
      {filters.from || filters.to ? <Button title="Any date" variant="ghost" small onPress={() => onChange({ from: "", to: "" })} /> : null}
    </Sheet>
  );
}
