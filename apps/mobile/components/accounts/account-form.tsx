// Add or edit an account in a sheet: name, institution, type, last digits, opening balance. Web: routes/accounts.tsx.

import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { invalidateLedger } from "@/components/data";
import { Button, Field, Picker, Sheet, Text } from "@/components/ui";
import { accountFormErrors, createInput, EMPTY_ACCOUNT_FORM, formFromAccount, INSTITUTION_OPTIONS, TYPE_OPTIONS, updateInput, type AccountForm, type AccountRow, type AccountType, type Institution } from "@/src/lib/accounts";
import { errorMessage } from "@/src/lib/errors";
import { client } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";

const INSTITUTION_GROUPS = [{ label: null, options: INSTITUTION_OPTIONS }];
const TYPE_GROUPS = [{ label: null, options: TYPE_OPTIONS }];

/** `account` null = add a new one. */
export function AccountFormSheet({ open, account, onClose }: { open: boolean; account: AccountRow | null; onClose: () => void }) {
  const [form, setForm] = useState<AccountForm>(EMPTY_ACCOUNT_FORM);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(account ? formFromAccount(account) : EMPTY_ACCOUNT_FORM);
    setTouched(false);
  }, [open, account]);
  const errors = useMemo(() => accountFormErrors(form), [form]);
  const set = (p: Partial<AccountForm>) => setForm((f) => ({ ...f, ...p }));

  const save = useMutation({
    mutationFn: async () => {
      if (!account) return client.accounts.create(createInput(form));
      const patch = updateInput(account, form);
      return patch ? client.accounts.update(patch) : null;
    },
    onSuccess: () => {
      toast.success(account ? "Account saved" : `Added ${form.name.trim()}`);
      invalidateLedger();
      onClose();
    },
    onError: (e) => toast.error(account ? "Couldn't save the account" : "Couldn't add the account", errorMessage(e, { storeSafe })),
  });

  const submit = () => {
    setTouched(true);
    if (!errors) save.mutate();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={account ? "Edit account" : "Add an account"}
      subtitle={account ? undefined : "Bank Jago pockets are created for you when you import a Jago statement."}
      footer={<Button title={account ? "Save" : "Add account"} loading={save.isPending} onPress={submit} />}
    >
      <Field label="Name" placeholder="BCA Tahapan" maxLength={80} value={form.name} onChangeText={(name) => set({ name })} error={touched ? errors?.name : null} autoCapitalize="words" />
      <Picker label="Institution" value={form.institution} groups={INSTITUTION_GROUPS} onChange={(v) => v && set({ institution: v as Institution })} searchPlaceholder="Search banks and wallets" />
      <Picker label="Type" value={form.type} groups={TYPE_GROUPS} onChange={(v) => v && set({ type: v as AccountType })} />
      <Field label="Last digits" placeholder="1234" keyboardType="number-pad" maxLength={8} value={form.last4} onChangeText={(last4) => set({ last4 })} error={touched ? errors?.last4 : null} hint="Helps match statements and notifications." />
      <Field
        label="Opening balance (Rp)"
        placeholder="0"
        keyboardType="numbers-and-punctuation"
        value={form.opening}
        onChangeText={(opening) => set({ opening })}
        error={touched ? errors?.opening : null}
        hint="What it held before the first transaction you import. A minus for a card or loan balance."
      />
      {account ? <Text variant="caption" tone="muted">Only what you change is saved. Transactions are not touched.</Text> : null}
    </Sheet>
  );
}
