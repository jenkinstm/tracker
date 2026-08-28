"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken, setToken } from "@/lib/api";

const NAV = [
  { href: "/", label: "Проекты" },
  { href: "/usage", label: "Расходы" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
    else setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur">
        {/* На узких экранах шапка переносится в две строки: иначе «Выйти» не помещается
            в 390 px и утягивает всю страницу в горизонтальный скролл. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
          <Link
            href="/"
            className="order-1 mr-auto flex items-center gap-2 text-base font-semibold sm:mr-4"
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
            RankPulse
          </Link>
          <button
            className="btn-ghost order-2 px-3 sm:order-3 sm:ml-auto sm:px-4"
            onClick={() => {
              setToken(null);
              router.replace("/login");
            }}
          >
            Выйти
          </button>
          <nav className="order-3 flex w-full gap-1 sm:order-2 sm:w-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`btn px-3 sm:px-4 ${
                  pathname === item.href ? "bg-slate-100 text-ink" : "text-muted hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
