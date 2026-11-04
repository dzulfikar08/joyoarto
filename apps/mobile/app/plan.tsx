import { ComingSoon } from "@/components/coming-soon";

// Follow-up: plan.baseline / plan.simulate / plan.compare / plan.scenarios.* (apps/web/src/routes/plan.tsx).
export default function PlanScreen() {
  return (
    <ComingSoon
      icon="calculator-outline"
      title="Plan & simulate"
      description="“Can we afford this?” from your own ledger: recurring income, core spending and savings."
      webPath="/plan"
      points={["Baseline from the last complete months", "Car loans, one-offs, monthly costs and income changes", "Saved scenarios shared with your household"]}
    />
  );
}
