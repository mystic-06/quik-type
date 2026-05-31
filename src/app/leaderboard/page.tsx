import { Construction } from "lucide-react";

export default function Leaderboard() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center animate-fade-in-up">
      <div className="nb-card p-12 text-center max-w-md">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--primary)] border-2 border-[var(--border)] rounded-lg shadow-[var(--shadow)] mb-6">
          <Construction className="w-8 h-8" />
        </div>
        <h1 className="text-[var(--ts-2xl)] font-black mb-3">
          Coming Soon
        </h1>
        <p className="text-[var(--text-secondary)] text-[var(--ts-base)] leading-relaxed">
          The leaderboard is under construction. Check back soon to see how you stack up against other typists!
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <div className="w-3 h-3 bg-[var(--primary)] border-2 border-[var(--border)] rounded-sm animate-pulse" />
          <div className="w-3 h-3 bg-[var(--secondary)] border-2 border-[var(--border)] rounded-sm animate-pulse" style={{ animationDelay: "0.2s" }} />
          <div className="w-3 h-3 bg-[var(--success)] border-2 border-[var(--border)] rounded-sm animate-pulse" style={{ animationDelay: "0.4s" }} />
        </div>
      </div>
    </div>
  );
}