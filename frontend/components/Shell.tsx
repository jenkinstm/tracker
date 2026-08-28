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
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
          <Link href="/" className="mr-4 flex items-center gap-2 text-base font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            RankPulse
          </Link>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`btn ${
                pathname === item.href ? "bg-slate-100 text-ink" : "text-muted hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <button
            className="btn-ghost ml-auto"
            onClick={() => {
              setToken(null);
              router.replace("/login");
            }}
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
