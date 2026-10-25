const shapes = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  sidebar: 'M9 4v16M4 4h16v16H4V4m11 5-3 3 3 3',
  expand: 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5',
  restore: 'M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.5 14.1A8.8 8.8 0 0 1 9.9 3.5 8.8 8.8 0 1 0 20.5 14.1Z',
  home: 'M3 10 12 3l9 7v10H6V10m3 10v-7h6v7',
  book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5',
  play: 'm9 5 11 7-11 7V5',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-5v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  blocks: 'M3 5h7v7H3V5m11 0h7v7h-7V5M8 16h8v5H8v-5',
  code: 'm7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18',
  chart: 'M4 3v17h17M8 15v-4m5 4V6m5 9v-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l4 2',
  alert: 'M12 3 2 21h20L12 3m0 6v5m0 3v1',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 8a9 9 0 1 0 0 8m0-13v5h-5',
  leaf: 'M19 3C6 3 3 8 5 15c2 6 12 4 14-12M5 20 15 9',
} as const;

export function Icon({ name, className = '' }: { name: keyof typeof shapes; className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={shapes[name]} />
    </svg>
  );
}
