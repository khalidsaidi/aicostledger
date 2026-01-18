import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

const navItems = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Ledger", to: "/ledger" },
  { label: "Connectors", to: "/connectors" },
  { label: "Settings", to: "/settings" }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();

  return (
    <div className="min-h-screen px-6 py-8">
      <header className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AICostLedger</p>
          <h1 className="text-3xl font-semibold">Spend ledger for AI providers</h1>
          <p className="text-sm text-muted-foreground">
            Collector-driven invoices, unified ledger, CSV-ready bookkeeping.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit p-4">
          <nav className="flex flex-col gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "rounded-2xl px-4 py-2 text-sm font-medium transition",
                    isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </Card>

        <main className="space-y-6 animate-rise">{children}</main>
      </div>
    </div>
  );
}
