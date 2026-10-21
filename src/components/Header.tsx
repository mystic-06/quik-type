"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Keyboard, Trophy, Users, UsersRound, Menu, X, Flag, LogOut } from "lucide-react";
import { EVENT_API_URL, eventFetch } from "@/lib/event";
import ProfileAvatar from "@/components/ProfileAvatar";

interface UserProfile { id: string; displayName: string; pictureUrl: string | null; isEventAdmin: boolean }

export default function Header() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [accountError, setAccountError] = useState("");

  useEffect(() => {
    let alive = true;
    eventFetch<UserProfile>("/auth/me")
      .then(profile => { if (alive) setUser(profile); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setAuthChecked(true); });
    return () => { alive = false; };
  }, []);

  const logout = async () => {
    setAccountError("");
    try {
      await eventFetch<{ ok: boolean }>("/auth/logout", { method: "POST" });
      setUser(null);
      setIsOpen(false);
      window.location.reload();
    } catch (reason) {
      setAccountError(reason instanceof Error ? reason.message : "Could not sign out.");
    }
  };

  const signInHref = `${EVENT_API_URL}/auth/login`;
  const accountControl = user ? (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 min-w-0" title={user.displayName}>
        <ProfileAvatar name={user.displayName} pictureUrl={user.pictureUrl} className="w-8 h-8 text-[10px]" />
        <span className="max-w-40 truncate text-sm font-bold">{user.displayName}</span>
      </div>
      <button type="button" onClick={() => void logout()} className="nb-btn nb-btn-ghost text-[var(--ts-sm)] !py-2 !px-3" aria-label="Log out"><LogOut className="h-4 w-4" /><span>Log out</span></button>
    </div>
  ) : authChecked ? (
    <a className="nb-btn nb-btn-primary text-[var(--ts-sm)] !py-2 !px-4" href={signInHref}>Sign in</a>
  ) : null;

  const navItems = [
    { href: "/", label: "Solo", icon: Keyboard },
    { href: "/multiplayer", label: "Multiplayer", icon: Users },
    { href: "/teams", label: "Teams", icon: UsersRound },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { href: "/event", label: "Event", icon: Flag },
  ];

  return (
    <header className="relative flex justify-between items-center nb-card px-6 py-3">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 group">
        <div className="w-9 h-9 flex items-center justify-center font-mono text-lg font-black bg-[var(--primary)] border-2 border-[var(--border)] rounded-md shadow-[2px_2px_0_var(--border)] group-hover:translate-x-[-1px] group-hover:translate-y-[-1px] group-hover:shadow-[3px_3px_0_var(--border)] transition-all duration-100">
          Q
        </div>
        <h1 className="text-[var(--ts-lg)] font-black tracking-tight">
          QuikType
        </h1>
      </Link>

      {/* Navigation */}
      <nav className="hidden md:flex">
        <ul className="flex items-center gap-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href === "/event" && pathname.startsWith("/event/"));
            return (
              <li key={href}>
                <Link href={href}>
                  <button
                    className={`px-4 py-2 flex items-center gap-2 rounded-md text-[var(--ts-sm)] font-semibold cursor-pointer transition-all duration-100
                      ${isActive
                        ? "bg-[var(--primary)] border-2 border-[var(--border)] shadow-[2px_2px_0_var(--border)]"
                        : "border-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--surface-alt)]"
                      }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hidden md:flex flex-col items-end gap-1">{accountControl}{accountError && <span role="alert" className="text-xs font-bold text-[var(--danger)]">{accountError}</span>}</div>

      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden p-2 border-2 border-[var(--border)] rounded-md hover:bg-[var(--surface-alt)] transition-colors cursor-pointer"
        aria-expanded={isOpen}
        aria-label="Toggle navigation menu"
      >
        {isOpen ? (
          <X className="w-5 h-5" strokeWidth={2.5} />
        ) : (
          <Menu className="w-5 h-5" strokeWidth={2.5} />
        )}
      </button>

      {/* Mobile dropdown menu */}
      {isOpen && (
        <div className="absolute top-[calc(100%+8px)] left-0 right-0 md:hidden nb-card p-4 z-50 flex flex-col gap-4">
          <nav className="w-full">
            <ul className="flex flex-col gap-2">
              {navItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href || (href === "/event" && pathname.startsWith("/event/"));
                return (
                  <li key={href}>
                    <Link href={href} onClick={() => setIsOpen(false)} className="block">
                      <button
                        className={`w-full px-4 py-3 flex items-center gap-3 rounded-md text-[var(--ts-sm)] font-semibold cursor-pointer transition-all duration-100
                          ${isActive
                            ? "bg-[var(--primary)] border-2 border-[var(--border)] shadow-[2px_2px_0_var(--border)]"
                            : "border-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--surface-alt)]"
                          }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </button>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          
          <div className="border-t-2 border-[var(--border)] my-1" />
          {user ? <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><ProfileAvatar name={user.displayName} pictureUrl={user.pictureUrl} className="w-8 h-8 text-[10px]" /><span className="truncate text-sm font-bold">{user.displayName}</span></div><button type="button" onClick={() => void logout()} className="nb-btn nb-btn-ghost !py-2 !px-3" aria-label="Log out"><LogOut className="h-4 w-4" /><span>Log out</span></button></div> : authChecked && <a className="nb-btn nb-btn-primary w-full justify-center" href={signInHref} onClick={() => setIsOpen(false)}>Sign in</a>}
          {accountError && <p role="alert" className="text-sm font-bold text-[var(--danger)]">{accountError}</p>}
        </div>
      )}
    </header>
  );
}
