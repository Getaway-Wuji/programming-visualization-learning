type Mode = 'light' | 'dark';
type Origin = { x: number; y: number };

function modePainted(root: HTMLElement, mode: Mode) {
  if (root.dataset.theme === mode) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = () => {
      observer.disconnect();
      window.clearTimeout(expiry);
      resolve(root.dataset.theme === mode);
    };
    const observer = new MutationObserver(() => {
      if (root.dataset.theme === mode) finish();
    });
    observer.observe(root, { attributeFilter: ['data-theme'] });
    const expiry = window.setTimeout(finish, 120);
  });
}

export async function revealTheme(mode: Mode, origin: Origin, apply: () => Promise<boolean>) {
  const root = document.documentElement;
  if (
    !document.startViewTransition ||
    typeof CSS.registerProperty !== 'function' ||
    document.hidden ||
    document.activeViewTransition ||
    root.dataset.themeReveal ||
    root.hasAttribute('data-card-expansion') ||
    root.dataset.reducedMotion === 'on' ||
    matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)').matches
  ) {
    await apply();
    return;
  }

  const x = Math.min(window.innerWidth, Math.max(0, origin.x));
  const y = Math.min(window.innerHeight, Math.max(0, origin.y));
  const radius =
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 20;
  root.dataset.themeReveal = 'active';
  root.style.setProperty('--theme-wave-x', `${x}px`);
  root.style.setProperty('--theme-wave-y', `${y}px`);
  root.style.setProperty('--theme-wave-end', `${radius}px`);
  const cleanUp = () => {
    delete root.dataset.themeReveal;
    root.style.removeProperty('--theme-wave-x');
    root.style.removeProperty('--theme-wave-y');
    root.style.removeProperty('--theme-wave-end');
  };

  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(async () => {
      if (!(await apply()) || !(await modePainted(root, mode))) transition.skipTransition();
    });
  } catch {
    cleanUp();
    await apply();
    return;
  }

  // Show the live page if persisting the theme takes longer than a normal frame transition.
  const deadline = window.setTimeout(() => transition.skipTransition(), 220);
  const clearDeadline = () => window.clearTimeout(deadline);
  void transition.ready.then(clearDeadline, clearDeadline);
  try {
    const [updated] = await Promise.allSettled([
      transition.updateCallbackDone,
      transition.finished,
    ]);
    if (updated.status === 'rejected') throw updated.reason;
  } finally {
    clearDeadline();
    cleanUp();
  }
}
