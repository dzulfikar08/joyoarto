// Recent imports (web: the "Recent imports" list on routes/accounts.tsx): every statement, CSV and email import, and
// Undo, which deletes what that import added (quick adds it confirmed go back to pending).

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "react-native";

import { invalidateLedger } from "@/components/data";
import { Button, ErrorState, ListRow, ListSection, SkeletonCard, Text } from "@/components/ui";
import { errorMessage } from "@/src/lib/errors";
import { importLogText, undoDoneText, undoPrompt } from "@/src/lib/imports";
import { client, orpc } from "@/src/lib/orpc";
import { storeSafe } from "@/src/lib/platform";
import { queryClient } from "@/src/lib/query";
import { toast } from "@/src/lib/toast";

const FIRST = 8;

export function ImportLog() {
  const q = useQuery(orpc.imports.list.queryOptions());
  const accounts = useQuery(orpc.accounts.list.queryOptions({ input: { includeArchived: true } }));
  const [all, setAll] = useState(false);
  const undo = useMutation({
    mutationFn: (id: string) => client.imports.undo({ id }),
    onSuccess: (r) => {
      toast.success("Import undone", undoDoneText(r));
      invalidateLedger();
      void queryClient.invalidateQueries({ queryKey: orpc.imports.key() });
    },
    onError: (e) => toast.error("Couldn't undo the import", errorMessage(e, { storeSafe })),
  });
  const names = new Map(accounts.data?.accounts.map((a) => [a.id, a.name]));
  const list = q.data?.imports ?? [];
  const shown = all ? list : list.slice(0, FIRST);

  if (q.isPending) return <SkeletonCard lines={3} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  if (!list.length) {
    return (
      <ListSection title="Recent imports">
        <ListRow icon="time-outline" iconTone="muted" title="None yet" subtitle="Statements and CSVs you import show here, with Undo." />
      </ListSection>
    );
  }
  return (
    <>
      <ListSection title="Recent imports" footer="Undo deletes the transactions that import added, to redo it with a better mapping.">
        {shown.map((i) => {
          const t = importLogText(i, names.get(i.accountId));
          return (
            <ListRow
              key={i.id}
              title={t.title}
              subtitle={t.subtitle}
              numberOfLines={2}
              right={
                <Button
                  title="Undo"
                  variant="ghost"
                  small
                  accessibilityLabel={`Undo ${t.title}`}
                  disabled={undo.isPending}
                  onPress={() =>
                    Alert.alert("Undo this import?", undoPrompt(i), [
                      { text: "Cancel", style: "cancel" },
                      { text: "Undo import", style: "destructive", onPress: () => undo.mutate(i.id) },
                    ])
                  }
                />
              }
            />
          );
        })}
      </ListSection>
      {list.length > FIRST ? <Button title={all ? "Show fewer" : `Show all ${list.length}`} variant="ghost" small onPress={() => setAll((v) => !v)} /> : null}
      {q.isError ? <Text variant="caption" tone="destructive">{errorMessage(q.error, { storeSafe })}</Text> : null}
    </>
  );
}
