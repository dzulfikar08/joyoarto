import { ComingSoon } from "@/components/coming-soon";

// Follow-up: accounts.list / accounts.create / accounts.update (apps/web/src/routes/accounts.tsx).
export default function AccountsScreen() {
  return (
    <ComingSoon
      icon="wallet-outline"
      title="Accounts"
      description="Bank accounts, e-wallets and cards with their balances. For now, balances are on Home."
      webPath="/accounts"
      points={["Add, rename and archive accounts", "Opening balances and account roles (emergency, goal, spending)", "Each account's transactions"]}
    />
  );
}
