export function Mark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g stroke="#C8A24B" strokeWidth="1.7" strokeLinecap="round" fill="none">
        <line x1="16" y1="6" x2="16" y2="24" />
        <line x1="6.5" y1="10.5" x2="25.5" y2="10.5" />
        <line x1="6.5" y1="10.5" x2="6.5" y2="14.5" />
        <line x1="25.5" y1="10.5" x2="25.5" y2="14.5" />
      </g>
      <circle cx="6.5" cy="16.6" r="2.5" fill="#C8A24B" />
      <circle cx="25.5" cy="16.6" r="2.5" fill="#C8A24B" />
      <circle cx="16" cy="6" r="2" fill="#E4BE63" />
      <rect x="11.5" y="24" width="9" height="2.2" rx="1.1" fill="#C8A24B" />
    </svg>
  );
}

export function Logo({ size = 30 }) {
  return (
    <span className="brand">
      <Mark size={size} />
      <span className="wordmark">
        ADJUDIC<b>A</b>
      </span>
    </span>
  );
}
