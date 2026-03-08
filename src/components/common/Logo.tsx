/**
 * Super eisy logo — deep indigo house with gold lightning bolt.
 * Renders as inline SVG for crisp scaling at any size.
 */

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 24, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="se-house" x1="32" y1="8" x2="32" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4338ca" />
          <stop offset="1" stopColor="#1e1b4b" />
        </linearGradient>
        <linearGradient id="se-bolt" x1="44" y1="0" x2="20" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fef9c3" />
          <stop offset=".35" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <path
        d="M 8 30 L 32 8 L 56 30 L 56 56 C 56 58 54 60 52 60 L 12 60 C 10 60 8 58 8 56 Z"
        fill="url(#se-house)"
        stroke="#6366f1"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <polygon points="44,-2 20,34 34,34 16,66 46,30 33,30" fill="url(#se-bolt)" />
    </svg>
  );
}
