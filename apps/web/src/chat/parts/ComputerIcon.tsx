/** A small, friendly computer with a pointer on its screen; the pointer moves while an agent is working on it. */
export function ComputerIcon({ busy = false, size = 16 }: { busy?: boolean; size?: number }) {
  return (
    <svg
      className={busy ? "computer-icon is-busy" : "computer-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="19" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 20.5h6M12 16.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        className="computer-icon__pointer"
        d="M10 7l0 6 1.7-1.6 1.1 2.4 1.1-.5-1.1-2.3 2.3-.1z"
        fill="currentColor"
      />
    </svg>
  );
}
