// Import: statement PDFs (batch preview, combined result), CSV exports with column mapping, the email-in address, and
// the import log with Undo. At parity with the web's apps/web/src/routes/import.tsx (+ -statement-import, -email-import).

import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import { CsvImport } from "@/components/import/csv-import";
import { EmailIn } from "@/components/import/email-in";
import { ImportLog } from "@/components/import/import-log";
import { StatementBatch } from "@/components/import/statement-batch";
import { Disclosure, Screen, Text } from "@/components/ui";
import { orpc } from "@/src/lib/orpc";

export default function ImportScreen() {
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const billing = useQuery(orpc.billing.status.queryOptions());
  return (
    <Screen>
      <Text tone="muted">Statements, CSV exports and email, all checked before anything is saved.</Text>
      <Disclosure title="How importing works" icon="information-circle-outline">
        Bank Jago and GoPay PDFs are read right here. For other banks, use their CSV export. Nothing is saved before you see a preview, and importing the same statement twice adds nothing twice.
      </Disclosure>
      <StatementBatch billing={billing.data} />
      <CsvImport initialAccountId={accountId} />
      <EmailIn billing={billing.data} />
      <ImportLog />
    </Screen>
  );
}
