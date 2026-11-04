import { Button, buttonVariants } from "@baroka/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CircleCheck, Clock, CircleX } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/kit";
import { requireSession } from "@/lib/auth";
import { longDate } from "@/lib/billing";
import { useLang } from "@/lib/lang";
import { client, errorMessage, orpc } from "@/lib/orpc";

type Search = { order?: string; polar?: "success" };

/** Where DOKU sends the buyer back (?order=ART-...) and Polar after a card checkout (?polar=success). */
export const Route = createFileRoute("/payment")({
  beforeLoad: requireSession,
  validateSearch: (s: Record<string, unknown>): Search => ({
    order: typeof s.order === "string" && /^[A-Za-z0-9:_-]{1,80}$/.test(s.order) ? s.order : undefined,
    polar: s.polar === "success" ? "success" : undefined,
  }),
  component: Payment,
});

/** Polls every 3 s for two minutes; the webhook usually lands within seconds. */
const POLL_MS = 3_000;
const POLL_FOR_MS = 120_000;

function Payment() {
  const { order, polar } = Route.useSearch();
  const en = useLang() === "en";
  const t = <V,>(id: V, eng: V) => (en ? eng : id);
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title={t("Pembayaran", "Payment")} />
      {order ? <OrderStatus id={order} t={t} en={en} /> : polar ? <PolarReturn t={t} en={en} /> : <p className="text-sm text-muted-foreground">{t("Nggak ada pembayaran yang dicek.", "No payment to check.")}</p>}
    </div>
  );
}

function useStillPolling() {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return { polling: now - started < POLL_FOR_MS, elapsed: now - started };
}

function OrderStatus({ id, t, en }: { id: string; t: <V>(id: V, en: V) => V; en: boolean }) {
  const qc = useQueryClient();
  const { polling, elapsed } = useStillPolling();
  const order = useQuery({
    ...orpc.billing.order.queryOptions({ input: { id } }),
    refetchInterval: (q) => (q.state.data?.status === "pending" && polling ? POLL_MS : false),
  });
  const check = useMutation({
    mutationFn: () => client.billing.checkOrder({ id }),
    onSuccess: (data) => qc.setQueryData(orpc.billing.order.queryKey({ input: { id } }), data),
  });
  const o = order.data;
  useEffect(() => {
    if (o?.status === "paid") void qc.invalidateQueries({ queryKey: orpc.billing.status.key() });
  }, [o?.status, qc]);

  if (order.isError) return <p className="text-sm text-destructive">{errorMessage(order.error)}</p>;
  if (!o) return <section className="card h-32" aria-busy />;
  if (o.status === "paid") {
    return (
      <section className="card space-y-3 text-sm">
        <CircleCheck className="size-8 text-positive" aria-hidden />
        <h2 className="text-lg font-bold tracking-tight">{t("Terima kasih, rumah tanggamu sekarang Pro!", "Thank you, your household is now on Pro!")}</h2>
        <p className="text-muted-foreground">
          {o.display} · {o.periodEnd ? t(`Pro sampai ${longDate(o.periodEnd, en)}.`, `Pro until ${longDate(o.periodEnd, en)}.`) : null}
        </p>
        <Link to="/settings" className={buttonVariants({ variant: "secondary" })}>
          {t("Lihat langganan", "See billing")}
        </Link>
      </section>
    );
  }
  if (o.status !== "pending") {
    return (
      <section className="card space-y-3 text-sm">
        <CircleX className="size-8 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-bold tracking-tight">{t("Pembayaran nggak selesai", "The payment did not go through")}</h2>
        <p className="text-muted-foreground">{t("Nggak ada uang yang ditagih untuk order ini. Coba lagi kapan saja.", "Nothing was charged for this order. Try again any time.")}</p>
        <Link to="/pricing" className={buttonVariants()}>
          {t("Coba lagi", "Try again")}
        </Link>
      </section>
    );
  }
  return (
    <section className="card space-y-3 text-sm">
      <Clock className="size-8 text-warning" aria-hidden />
      <h2 className="text-lg font-bold tracking-tight">{t("Menunggu konfirmasi pembayaran…", "Waiting for the payment to be confirmed…")}</h2>
      <p className="text-muted-foreground">
        {t(
          `Order ${o.display}. Kalau sudah bayar, biasanya terkonfirmasi dalam beberapa detik. Halaman ini cek sendiri.`,
          `Order of ${o.display}. Once you have paid it usually confirms within seconds. This page checks by itself.`,
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {/* DOKU asks for status checks at least a minute after payment; offer it after 20 s, or once polling stops. */}
        {(elapsed > 20_000 || !polling) && (
          <Button variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? t("Mengecek…", "Checking…") : t("Cek pembayaran sekarang", "Check payment now")}
          </Button>
        )}
        <Link to="/settings" className={buttonVariants({ variant: "ghost" })}>
          {t("Nanti saja", "Later")}
        </Link>
      </div>
      <code className="block text-[11px] text-muted-foreground">{o.id}</code>
    </section>
  );
}

function PolarReturn({ t, en }: { t: <V>(id: V, en: V) => V; en: boolean }) {
  const { polling } = useStillPolling();
  const status = useQuery({
    ...orpc.billing.status.queryOptions(),
    refetchInterval: (q) => (q.state.data?.entitlement.provider !== "polar" && polling ? POLL_MS : false),
  });
  const done = status.data?.entitlement.provider === "polar";
  return (
    <section className="card space-y-3 text-sm">
      {done ? <CircleCheck className="size-8 text-positive" aria-hidden /> : <Clock className="size-8 text-warning" aria-hidden />}
      <h2 className="text-lg font-bold tracking-tight">
        {done ? t("Terima kasih, rumah tanggamu sekarang Pro!", "Thank you, your household is now on Pro!") : t("Menunggu konfirmasi dari Polar…", "Waiting for Polar to confirm…")}
      </h2>
      {done && status.data?.entitlement.periodEnd && (
        <p className="text-muted-foreground">{t(`Diperpanjang ${longDate(status.data.entitlement.periodEnd, en)}.`, `Renews ${longDate(status.data.entitlement.periodEnd, en)}.`)}</p>
      )}
      {!done && !polling && <p className="text-muted-foreground">{t("Ini makan waktu lebih lama dari biasanya. Cek lagi di Pengaturan sebentar lagi.", "This is taking longer than usual. Check Settings again in a little while.")}</p>}
      <Link to="/settings" className={buttonVariants({ variant: "secondary" })}>
        {t("Lihat langganan", "See billing")}
      </Link>
    </section>
  );
}
