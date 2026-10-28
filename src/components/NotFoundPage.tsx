import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, LayoutDashboard, Rocket } from "lucide-react";

import { useAuth } from "@/components/AuthProvider";

/**
 * Full-screen 404 page for the Roket dark theme.
 *
 * Rendered by the root route's `notFoundComponent`, so it covers every
 * unmatched URL. It lives inside `AuthProvider`, which lets us show the
 * dashboard shortcut only for signed-in users.
 */
export function NotFoundPage() {
  const { user, loading } = useAuth();
  const reduceMotion = useReducedMotion();
  const showDashboard = !loading && Boolean(user);

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#0B1120] px-4 py-16">
      {/* Ambient depth: emerald / cyan orbs + a faint vignette. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -left-32 top-1/4 h-[24rem] w-[24rem] rounded-full bg-emerald-500/25 blur-[110px] sm:h-[32rem] sm:w-[32rem]"
          animate={
            reduceMotion ? { opacity: 0.7 } : { opacity: [0.5, 0.85, 0.5], scale: [1, 1.08, 1] }
          }
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -right-32 bottom-1/4 h-[24rem] w-[24rem] rounded-full bg-cyan-500/25 blur-[110px] sm:h-[32rem] sm:w-[32rem]"
          animate={
            reduceMotion
              ? { opacity: 0.65 }
              : { opacity: [0.45, 0.8, 0.45], scale: [1.08, 1, 1.08] }
          }
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#0B1120_78%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 mx-auto w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-[0_30px_90px_-30px_rgba(16,185,129,0.45)] backdrop-blur-xl sm:p-10"
      >
        <motion.div
          animate={reduceMotion ? { y: 0 } : { y: [0, -10, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-400/20 to-cyan-400/10 shadow-[0_0_45px_-8px_rgba(16,185,129,0.7)]"
        >
          <Rocket
            className="h-10 w-10 text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </motion.div>

        <motion.h1
          className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text font-display text-7xl font-bold tracking-tight text-transparent sm:text-8xl"
          animate={
            reduceMotion
              ? { filter: "none" }
              : {
                  filter: [
                    "drop-shadow(0 0 12px rgba(16, 185, 129, 0.35))",
                    "drop-shadow(0 0 28px rgba(34, 211, 238, 0.65))",
                    "drop-shadow(0 0 12px rgba(16, 185, 129, 0.35))",
                  ],
                }
          }
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        >
          404
        </motion.h1>

        <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
          Lost in Space?
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400 sm:text-base">
          The page you are looking for doesn't exist or has been moved. Let's get you back on track.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <motion.div
            whileHover={reduceMotion ? { scale: 1 } : { scale: 1.05 }}
            whileTap={reduceMotion ? { scale: 1 } : { scale: 0.95 }}
            className="w-full sm:w-auto"
          >
            <Link
              to="/"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-3 font-display text-sm font-bold text-[#04121A] shadow-[0_0_30px_-6px_rgba(16,185,129,0.8)] transition-colors hover:from-emerald-300 hover:to-cyan-300 focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1120] focus-visible:outline-none"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to Home
            </Link>
          </motion.div>

          {showDashboard ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
              whileHover={reduceMotion ? { scale: 1 } : { scale: 1.05 }}
              whileTap={reduceMotion ? { scale: 1 } : { scale: 0.95 }}
              className="w-full sm:w-auto"
            >
              <Link
                to="/dashboard"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-display text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1120] focus-visible:outline-none"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Go to Dashboard
              </Link>
            </motion.div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
