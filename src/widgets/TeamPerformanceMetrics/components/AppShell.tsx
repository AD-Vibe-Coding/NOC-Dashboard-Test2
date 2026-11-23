import { NavLink, Outlet } from "react-router-dom";
import { BarChart3, Gavel, LayoutDashboard, PenLine, Sparkles, TrendingUp, Upload, UserRound } from "lucide-react";
import { cn } from "@/widgets/TeamPerformanceMetrics/lib/utils";
import { useIdentity } from "../../../lib/identity";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/trends", label: "Team Metrics", icon: TrendingUp },
  { to: "/individual", label: "Individual Metrics", icon: UserRound },
  { to: "/insights", label: "Insights", icon: Sparkles },
  { to: "/generate", label: "Generate", icon: PenLine },
  { to: "/upload", label: "Upload", icon: Upload },
  { to: "/disputes", label: "Disputes", icon: Gavel },
];

const TEAM_MEMBER_NAV_PATHS = new Set(["/", "/trends", "/individual"]);

export function AppShell() {
  const { identity } = useIdentity();
  const isManager = identity?.role === "manager";
  const navItems = isManager ? NAV : NAV.filter((item) => TEAM_MEMBER_NAV_PATHS.has(item.to));

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <a
        href="#team-performance-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 md:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground" aria-hidden="true">
              <BarChart3 className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold tracking-wide text-foreground">Devs.ai</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Team Performance Metrics
              </p>
            </div>
          </div>
          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 md:flex" aria-label="Widget navigation">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-150",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-3.5" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 md:hidden" aria-label="Widget navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "shrink-0 rounded-md px-3 py-1 text-xs",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="team-performance-main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
        <Outlet />
      </main>
    </div>
  );
}
