import { Link } from "@tanstack/react-router";
import { Twitter, Send, Facebook, Youtube, Instagram, type LucideIcon } from "lucide-react";

type Social = { icon: LucideIcon; label: string };

const socials: Social[] = [
  { icon: Twitter, label: "X (Twitter)" },
  { icon: Send, label: "Telegram" },
  { icon: Facebook, label: "Facebook" },
  { icon: Youtube, label: "YouTube" },
  { icon: Instagram, label: "Instagram" },
];

export function Footer() {
  return (
    <footer className="border-t bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <img src="/logo.png" alt="Roket" className="h-9" />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Simple crypto trading plans, daily profits, and payouts that actually arrive.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Product
              </h3>
              <ul className="mt-4 space-y-2 text-sm">
                <li>
                  <Link to="/" className="transition-colors hover:text-primary">
                    Home
                  </Link>
                </li>
                <li>
                  <Link to="/" hash="pricing" className="transition-colors hover:text-primary">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link to="/signup" className="transition-colors hover:text-primary">
                    Get Started
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Legal
              </h3>
              <ul className="mt-4 space-y-2 text-sm">
                <li>
                  <Link to="/terms" className="transition-colors hover:text-primary">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className="transition-colors hover:text-primary">
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Support
              </h3>
              <ul className="mt-4 space-y-2 text-sm">
                <li className="text-muted-foreground">24/7 Live Chat</li>
                <li className="text-muted-foreground">Instant Payouts</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-6 border-t pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © 2026 Roket. All rights reserved.
          </p>
          <div className="flex gap-3">
            {socials.map((s) => (
              <a
                key={s.label}
                href="#"
                aria-label={s.label}
                className="grid h-9 w-9 place-items-center rounded-full border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <s.icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
