import { buttonVariants } from "@baroka/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { setNotFound } from "@/lib/head";
import { useLang } from "@/lib/lang";

/** Unknown paths: a 404 page that search engines are told not to index. */
export function NotFound() {
  const en = useLang() === "en";
  useEffect(() => {
    setNotFound(true);
    return () => setNotFound(false);
  }, []);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-bold text-primary">404</p>
      <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight">{en ? "Page not found" : "Halaman tidak ditemukan"}</h1>
      <p className="mt-2 text-muted-foreground">
        {en ? "The link may be old or mistyped." : "Mungkin link-nya sudah lama atau salah ketik."}
      </p>
      <Link to="/" className={buttonVariants({ className: "mt-6" })}>
        {en ? "Back to home" : "Kembali ke beranda"}
      </Link>
    </div>
  );
}
