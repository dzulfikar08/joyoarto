// Set, change or remove a monthly category budget (budgets.set; 0 removes). Web: BudgetForm on routes/-dashboard.tsx.

import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

import { useCategoryGroups } from "@/components/data";
import { Button, Field, Picker, Row, Sheet, Text } from "@/components/ui";
import { categoriesWithoutBudget, parseBudget } from "@/src/lib/budgets";
import { errorMessage } from "@/src/lib/errors";
import { amountInputText } from "@/src/lib/format";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { queryClient } from "@/src/lib/query";
import { toast } from "@/src/lib/toast";

export type BudgetTarget = { category: string; name: string; amount: number } | "new";

const refresh = () => {
  void queryClient.invalidateQueries({ queryKey: orpc.reports.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.budgets.key() });
};

export function BudgetSheet({ target, budgeted, onClose }: { target: BudgetTarget | null; budgeted: string[]; onClose: () => void }) {
  const editing = target && target !== "new" ? target : null;
  const groups = useCategoryGroups("expense");
  const free = useMemo(() => groups.map((g) => ({ ...g, options: categoriesWithoutBudget(g.options, budgeted) })).filter((g) => g.options.length), [groups, budgeted]);
  const [category, setCategory] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!target) return;
    setCategory(editing?.category ?? null);
    setAmount(editing ? amountInputText(editing.amount) : "");
    setTouched(false);
  }, [target, editing]);
  const parsed = parseBudget(amount);

  const save = useMutation({
    mutationFn: (v: { category: string; amount: number }) => client.budgets.set(v),
    onSuccess: (_r, v) => {
      toast.success(v.amount === 0 ? "Budget removed" : "Budget saved");
      refresh();
      onClose();
    },
    onError: (e) => toast.error("Couldn't save the budget", errorMessage(e, { storeSafe })),
  });

  const submit = () => {
    setTouched(true);
    if (category && "amount" in parsed) save.mutate({ category, amount: parsed.amount });
  };
  const remove = () =>
    editing &&
    Alert.alert(`Remove the ${editing.name} budget?`, "Its spending is still tracked; only the monthly limit goes.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => save.mutate({ category: editing.category, amount: 0 }) },
    ]);

  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={editing ? `${editing.name} budget` : "New budget"}
      subtitle="A monthly limit for one expense category, the same every month"
      footer={
        <Row>
          {editing ? <Button title="Remove" variant="destructive" disabled={save.isPending} onPress={remove} /> : null}
          <Button title="Save" flex loading={save.isPending} disabled={!category} onPress={submit} />
        </Row>
      }
    >
      {!editing ? (
        <Picker label="Category" value={category} groups={free} onChange={setCategory} placeholder="Choose an expense category" searchPlaceholder="Search categories" />
      ) : null}
      {!editing && !free.length ? <Text variant="caption" tone="muted">Every expense category already has a budget.</Text> : null}
      <Field
        label="Monthly limit (Rp)"
        placeholder="1.500.000"
        keyboardType="numbers-and-punctuation"
        value={amount}
        onChangeText={setAmount}
        error={touched && "error" in parsed ? parsed.error : null}
        autoFocus={!!editing}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </Sheet>
  );
}
