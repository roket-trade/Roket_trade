import { Link } from "@tanstack/react-router";
import { Crisp } from "crisp-sdk-web";
import { useAuth } from "@/components/AuthProvider";
import { Twitter, Send, Facebook, Youtube, Instagram, type LucideIcon } from "lucide-react";

type Social = { icon: LucideIcon; label: string };

const socials: Social[] = [
  { icon: Twitter, label: "X (Twitter)" },
  { icon: Send, label: "Telegram" },
  { icon: Facebook, label: "Facebook" },
  { icon: Youtube, label: "YouTube" },
  { icon: Instagram, label: "Instagram" },
];

const linkClass = "transition-colors hover:text-primary";

export function Footer() {
  const { user } = useAuth();

  // Same entry point as the dashboard: the Crisp bubble is hidden globally, so
  // it has to be shown again before the chat window is opened.
  const openLiveChat = () => {
    if (typeof window === "undefined") return;
    Crisp.chat.show();
    Crisp.chat.open();
  };

  return (
    <footer className="border-t bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <img src="/logo.png" alt="Roket" className="h-9" />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The smartest way to automate your crypto trading and earn passive income daily.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Product
              </h3>
              <ul className="mt-4 space-y-2 text-sm">
                <li>
                  <Link to="/" className={linkClass}>
                    Home
                  </Link>
                </li>
                <li>
                  <Link to="/" hash="pricing" className={linkClass}>
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link to="/signup" className={linkClass}>
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
                  <Link to="/terms" className={linkClass}>
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className={linkClass}>
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-6 border-t pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">© 2026 Roket. All rights reserved.</p>
          <nav
            aria-label="Legal"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground"
          >
            <Link to="/terms" className={linkClass}>
              Terms of Service
            </Link>
            <Link to="/privacy" className={linkClass}>
              Privacy Policy
            </Link>
            <Link to={user ? "/dashboard" : "/login"} className={linkClass}>
              Submit a Ticket
            </Link>
            <button type="button" onClick={openLiveChat} className={linkClass}>
              Live Chat
            </button>
          </nav>
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
