function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-14 w-14 text-base",
} as const;

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
}

/** Shows the user's real avatar when User.avatarUrl is set; otherwise a
 * deterministic initials circle — no schema-required image, no external
 * avatar service dependency. */
export function UserAvatar({ name, avatarUrl, size = "sm" }: UserAvatarProps) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- admin-entered/external avatar URL
      <img src={avatarUrl} alt={name} className={`${SIZE_CLASSES[size]} shrink-0 rounded-full object-cover`} />
    );
  }

  return (
    <span
      className={`inline-flex ${SIZE_CLASSES[size]} shrink-0 items-center justify-center rounded-full bg-gold-champagne/15 font-semibold text-gold-dark`}
      aria-hidden
    >
      {getInitials(name)}
    </span>
  );
}
