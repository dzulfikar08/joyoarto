// Transactions: search, filters (account, category or uncategorized, status, dates), an infinite list grouped by day,
// per-row categorize with "remember this merchant" (a rule), tap a row for detail and edit. At parity with the web's
// apps/web/src/routes/transactions.tsx. Home opens this tab with filters as route params.

import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useAccountGroups, useCategoryGroups } from "@/components/data";
import { CategorySheet } from "@/components/transactions/category-sheet";
import { FilterSheet } from "@/components/transactions/filter-sheet";
import { TransactionRow, type Tx } from "@/components/transactions/row";
import { Button, EmptyState, ErrorState, Icon, IconButton, Input, Pill, SkeletonRows, Text, useTabContentInset } from "@/components/ui";
import { openAddSheet } from "@/src/lib/add-sheet";
import { dayLabel } from "@/src/lib/format";
import { findOption } from "@/src/lib/options";
import { orpc } from "@/src/lib/orpc";
import { rememberTransaction } from "@/src/lib/tx-cache";
import { activeFilterCount, EMPTY_FILTERS, filtersFromParams, groupByDay, isFiltered, searchInput, type Filters } from "@/src/lib/transaction-filters";

export default function Transactions() {
  const router = useRouter();
  const { theme } = useUnistyles();
  const params = useLocalSearchParams();
  const bottom = useTabContentInset();
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(params));
  const [qText, setQText] = useState(filters.q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFor, setCategoryFor] = useState<Tx | null>(null);
  const accounts = useAccountGroups();
  const categories = useCategoryGroups();

  // Home links here with filters: a new set of params replaces the filters.
  const paramKey = JSON.stringify(params);
  useEffect(() => {
    const next = filtersFromParams(params);
    if (Object.keys(params).length) {
      setFilters(next);
      setQText(next.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  // The search box follows typing after a pause.
  useEffect(() => {
    if (qText === filters.q) return;
    const id = setTimeout(() => setFilters((f) => ({ ...f, q: qText })), 300);
    return () => clearTimeout(id);
  }, [qText, filters.q]);

  const input = searchInput(filters);
  const list = useInfiniteQuery(
    orpc.transactions.search.infiniteOptions({
      input: (cursor: string | undefined) => ({ ...input, ...(cursor ? { cursor } : {}) }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.transactions) ?? [], [list.data]);
  const sections = useMemo(() => groupByDay(rows), [rows]);
  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const filtered = isFiltered(filters);
  const count = activeFilterCount(filters);

  const openRow = useCallback(
    (t: Tx) => {
      rememberTransaction(t);
      router.push({ pathname: "/transaction/[id]", params: { id: t.id } });
    },
    [router],
  );

  const chips: { key: string; label: string; clear: Partial<Filters> }[] = [];
  if (filters.accountId) chips.push({ key: "acc", label: findOption(accounts, filters.accountId)?.label ?? "Account", clear: { accountId: "" } });
  if (filters.uncategorized) chips.push({ key: "unc", label: "Uncategorized", clear: { uncategorized: false } });
  else if (filters.category) chips.push({ key: "cat", label: findOption(categories, filters.category)?.label ?? filters.category, clear: { category: "" } });
  if (filters.status) chips.push({ key: "st", label: filters.status === "pending" ? "Pending" : "Posted", clear: { status: "" } });
  if (filters.from || filters.to) chips.push({ key: "date", label: `${filters.from ? dayLabel(filters.from) : "…"} – ${filters.to ? dayLabel(filters.to) : "today"}`, clear: { from: "", to: "" } });

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <View style={styles.head}>
        <Text variant="title" accessibilityRole="header">Transactions</Text>
        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Icon name="search" size={18} tone="muted" />
            <Input
              value={qText}
              onChangeText={setQText}
              placeholder="Search description or merchant"
              maxLength={40}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search transactions"
              style={styles.searchInput}
            />
          </View>
          <View>
            <IconButton name="options-outline" label={`Filters${count ? `, ${count} on` : ""}`} onPress={() => setFilterOpen(true)} />
            {count ? (
              <View style={styles.badge} pointerEvents="none">
                <Text variant="caption" style={{ color: theme.colors.primaryForeground, fontSize: 10 }}>{count}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {chips.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((c) => (
              <Pill key={c.key} label={`${c.label}  ✕`} selected onPress={() => patch(c.clear)} />
            ))}
            <Pill
              label="Clear"
              onPress={() => {
                setFilters(EMPTY_FILTERS);
                setQText("");
              }}
            />
          </ScrollView>
        ) : null}
      </View>

      {list.isPending ? (
        <View style={styles.pad}>
          <SkeletonRows />
        </View>
      ) : list.isError && !rows.length ? (
        <View style={styles.pad}>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          renderItem={({ item, index, section }) => (
            <View style={[styles.item, index === 0 && styles.first, index === section.data.length - 1 && styles.last]}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <TransactionRow t={item} onPress={openRow} onCategory={setCategoryFor} />
            </View>
          )}
          renderSectionHeader={({ section }) => (
            <Text variant="caption" tone="muted" style={styles.sectionHead} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottom || 24 }]}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
          ListHeaderComponent={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} compact /> : undefined}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <ActivityIndicator color={theme.colors.primary} style={{ padding: 16 }} />
            ) : list.hasNextPage ? (
              <Button title="Load more" variant="ghost" small onPress={() => void list.fetchNextPage()} />
            ) : rows.length ? (
              <Text variant="caption" tone="muted" style={{ textAlign: "center", padding: 16 }}>
                {rows.length} transaction{rows.length === 1 ? "" : "s"}
              </Text>
            ) : undefined
          }
          ListEmptyComponent={
            filtered ? (
              <EmptyState icon="search-outline" title="Nothing matches" description="No transactions match these filters." action={<Button title="Clear filters" variant="secondary" small onPress={() => (setFilters(EMPTY_FILTERS), setQText(""))} />} />
            ) : (
              <EmptyState
                icon="receipt-outline"
                title="No transactions yet"
                description="Import a statement, ask Claude to import one, or quick add what you just spent."
                action={
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button title="Import" small onPress={() => router.push("/import")} />
                    <Button title="Quick add" variant="secondary" small onPress={() => openAddSheet()} />
                  </View>
                }
              />
            )
          }
        />
      )}

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} onChange={patch} />
      <CategorySheet tx={categoryFor} onClose={() => setCategoryFor(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  head: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  search: { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: theme.colors.card, borderRadius: theme.radius.pill, paddingLeft: 14, borderWidth: 1, borderColor: theme.colors.input },
  searchInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent", minHeight: 44, paddingVertical: 8 },
  badge: { position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  chips: { gap: 6, paddingRight: theme.spacing.lg },
  pad: { paddingHorizontal: theme.spacing.lg },
  listContent: { paddingHorizontal: theme.spacing.lg },
  sectionHead: { paddingTop: theme.spacing.md, paddingBottom: 6, paddingHorizontal: 4, fontFamily: theme.fonts.medium },
  item: { backgroundColor: theme.colors.card, overflow: "hidden" },
  first: { borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card },
  last: { borderBottomLeftRadius: theme.radius.card, borderBottomRightRadius: theme.radius.card },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: theme.spacing.lg },
}));
