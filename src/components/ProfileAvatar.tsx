interface ProfileAvatarProps {
  name: string;
  pictureUrl?: string | null;
  className?: string;
}

export default function ProfileAvatar({ name, pictureUrl, className = "" }: ProfileAvatarProps) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--border)] bg-[var(--primary)] font-black ${className}`} role={pictureUrl ? "img" : undefined} aria-label={pictureUrl ? `${name} profile photo` : undefined}>
      <span aria-hidden="true">{initials}</span>
      {pictureUrl && <img src={pictureUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
    </span>
  );
}
