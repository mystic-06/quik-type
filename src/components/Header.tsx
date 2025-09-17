"use client";
import Link from "next/link";
import { Keyboard, Trophy, Users } from "lucide-react";

export default function Header() {
  return (
    <>
      <header className="flex justify-between items-center w-[88vw] min-h-[60px] h-14 rounded-2xl px-8 py-4 sticky top-4 z-50 bg-surface/95 backdrop-blur-md border border-white/10 text-primary shadow-lg transition-all duration-300 ease-in-out">
        <div className="flex items-center">
          <Link href="/">
            <h1 className="text-3xl font-bold cursor-pointer font-rubik text-accent-secondary hover:text-accent-secondary/80 transition-colors duration-200">
              QuikType
            </h1>
          </Link>
        </div>

        <nav className="hidden md:flex font-rubik">
          <ul className="flex space-x-8 items-center">
            <li>
              <Link href="/">
                <button className="px-4 py-2 flex items-center justify-center gap-2 bg-transparent text-secondary text-base font-medium cursor-pointer hover:text-primary hover:bg-white/5 rounded-lg transition-all duration-200 ease-out">
                  <Keyboard className="h-4 w-4" />
                  <span>Solo</span>
                </button>
              </Link>
            </li>
            <li>
              <Link href="/multiplayer">
                <button className="px-4 py-2 flex items-center justify-center gap-2 bg-transparent text-secondary text-base font-medium cursor-pointer hover:text-primary hover:bg-white/5 rounded-lg transition-all duration-200 ease-out">
                  <Users className="h-4 w-4" />
                  <span>Multiplayer</span>
                </button>
              </Link>
            </li>
            <li>
              <Link href="">
                <button className="px-4 py-2 flex items-center justify-center gap-2 bg-transparent text-secondary text-base font-medium cursor-pointer hover:text-primary hover:bg-white/5 rounded-lg transition-all duration-200 ease-out">
                  <Trophy className="h-4 w-4" />
                  <span>Leaderboard</span>
                </button>
              </Link>
            </li>
          </ul>
        </nav>
        <div className="hidden md:flex items-center space-x-4">
          <Link
            href="https://github.com/your-repo"
            target="_blank"
            rel="noopener noreferrer"
          >
            <button className="px-5 py-2.5 flex items-center justify-center font-rubik gap-2 rounded-lg shadow-md bg-gradient-to-r from-[#1c2035] to-[#252a42] text-white text-sm font-medium cursor-pointer hover:from-[#252a42] hover:to-[#2d3348] hover:shadow-lg transform hover:scale-105 transition-all duration-200 ease-out">
              <img
                src="/github-light.svg"
                className="h-4 w-4"
                alt="GitHub icon"
              ></img>
              <span>Star on GitHub</span>
            </button>
          </Link>
        </div>
      </header>
    </>
  );
}
