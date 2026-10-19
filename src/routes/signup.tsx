import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/roket-logo.png.asset.json";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign up — Roket" },
      { name: "description", content: "Create your Roket account and start trading." },
      { property: "og:title", content: "Sign up — Roket" },
      { property: "og:description", content: "Create your Roket account and start trading." },
    ],
  }),
  component: Signup,
});

const input = "w-full rounded-lg border bg-muted px-4 py-3 outline-none focus:border-primary";

function Signup() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={(e) => e.preventDefault()} className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-8 shadow-glow">
        <Link to="/"><img src={logo.url} alt="Roket" className="mx-auto h-10" /></Link>
        <h1 className="text-center text-2xl font-bold">Create your account</h1>
        <input className={input} placeholder="Full name" required />
        <input className={input} type="email" placeholder="Email" required />
        <input className={input} type="password" placeholder="Password" required />
        <button className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground">Sign up</button>
      </form>
    </div>
  );
}
