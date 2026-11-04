import { useQuery } from "@tanstack/react-query";

import { useApi } from "@/src/lib/auth";

/** Shared queries; React Query keeps them fresh between screens. */
export function useAccounts() {
  const api = useApi();
  return useQuery({ queryKey: ["accounts", api.server], queryFn: () => api.accounts(), staleTime: 60_000 });
}

export function useCategories() {
  const api = useApi();
  return useQuery({ queryKey: ["categories", api.server], queryFn: () => api.categories(), staleTime: 5 * 60_000 });
}

export function useAccountOptions() {
  const { data } = useAccounts();
  return (data ?? []).filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name, hint: [a.institution, a.last4 && `•${a.last4}`].filter(Boolean).join(" ") || undefined }));
}

export function useCategoryOptions() {
  const { data } = useCategories();
  return (data ?? []).map((c) => ({ value: c.slug, label: c.name, hint: c.slug }));
}
