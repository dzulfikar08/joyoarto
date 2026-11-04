import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { invalidateLedger, useCategoryGroups } from "@/components/data";
import { PickerSheet, SwitchRow } from "@/components/ui";
import { errorMessage } from "@/src/lib/errors";
import { client } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { toast } from "@/src/lib/toast";
import { categorizeCall, ruleSavedText } from "@/src/lib/transaction-filters";
import type { Tx } from "./row";

/**
 * Categorize one transaction from a searchable list. "Remember for <merchant>" (on by default, like the web) also
 * saves a rule (merchant equals) and fills in that merchant's past uncategorized rows.
 */
export function CategorySheet({ tx, onClose, onSaved }: { tx: Tx | null; onClose: () => void; onSaved?: (category: string | null) => void }) {
  const groups = useCategoryGroups();
  const [remember, setRemember] = useState(true);
  const save = useMutation({
    mutationFn: async ({ t, category }: { t: Tx; category: string | null }) => {
      const call = categorizeCall(t, category, remember);
      if (call.kind === "clear") {
        await client.transactions.update(call.input);
        return null;
      }
      return client.transactions.categorize(call.input);
    },
    onSuccess: (res, v) => {
      const rule = res ? ruleSavedText(res) : null;
      if (rule) toast.success("Rule saved", rule);
      else toast.success(v.category ? "Category saved" : "Category cleared");
      invalidateLedger();
      onSaved?.(v.category);
    },
    onError: (e) => toast.error("Couldn't change the category", errorMessage(e, { storeSafe })),
  });
  const merchant = tx?.merchant?.trim();
  return (
    <PickerSheet
      open={!!tx}
      onClose={onClose}
      title={tx ? `Category · ${tx.merchant ?? tx.description}` : "Category"}
      value={tx?.category}
      groups={groups}
      none="Uncategorized"
      searchPlaceholder="Search categories"
      onChange={(category) => tx && save.mutate({ t: tx, category })}
      footer={
        merchant ? (
          <SwitchRow
            label={`Remember for “${merchant}”`}
            hint="Adds a rule and fills in this merchant's past uncategorized transactions."
            value={remember}
            onValueChange={setRemember}
          />
        ) : null
      }
    />
  );
}
