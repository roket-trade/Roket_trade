import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import logo from "@/assets/roket-logo.png.asset.json";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-80 w-80 rounded-full bg-secondary/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-8 flex justify-center">
          <img src={logo.url} alt="Roket" className="h-11" />
        </Link>
        <div className="rounded-2xl border bg-card/95 p-6 shadow-glow backdrop-blur sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
