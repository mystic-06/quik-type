"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Keyboard, Trophy, Users, Github } from "lucide-react";

export default function Header() {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "Solo", icon: Keyboard },
    { href: "/multiplayer", label: "Multiplayer", icon: Users },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  ];

  return (
    <header className="flex justify-between items-center nb-card px-6 py-3">
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
            const isActive = pathname === href;
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

      {/* GitHub button */}
      <div className="hidden md:flex items-center">
        <Link
          href="https://github.com/mystic-06/quik-type"
          target="_blank"
          rel="noopener noreferrer"
        >
          <button className="nb-btn nb-btn-ghost text-[var(--ts-sm)] !py-2 !px-4 !border-2 !border-[var(--border)] !shadow-[2px_2px_0_var(--border)] hover:!shadow-[3px_3px_0_var(--border)] hover:!translate-x-[-1px] hover:!translate-y-[-1px]">
            <Github className="h-4 w-4" />
            <span>Star</span>
          </button>
        </Link>
      </div>

      {/* Mobile menu */}
      <button className="md:hidden p-2 border-2 border-[var(--border)] rounded-md hover:bg-[var(--surface-alt)] transition-colors">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
        </svg>
      </button>
    </header>
  );
}
