import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

interface CardExpansion {
  destination: string;
  originKey: string;
  startedAt: number;
  bounds: Keyframe;
  revealTarget: boolean;
}

let pending: CardExpansion | undefined;
let finishActive: (() => void) | undefined;

function allowsExpansion() {
  const root = document.documentElement;
  return (
    typeof Element.prototype.animate === 'function' &&
    root.dataset.reducedMotion !== 'on' &&
    !root.hasAttribute('data-theme-reveal') &&
    !document.hidden &&
    !matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)').matches
  );
}

function surfaceBounds(element: HTMLElement): Keyframe | undefined {
  const box = element.getBoundingClientRect();
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const width = Math.min(window.innerWidth, box.right) - left;
  const height = Math.min(window.innerHeight, box.bottom) - top;
  if (width < 16 || height < 16) return;
  const style = getComputedStyle(element);
  const hasFill = style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    borderRadius: hasFill ? style.borderRadius : 'var(--appearance-control-radius, 9px)',
    backgroundColor: hasFill ? style.backgroundColor : 'var(--p05-surface)',
  };
}

export function requestCardExpansion(
  source: HTMLElement,
  destination: string,
  originKey: string,
  { revealTarget = false }: { revealTarget?: boolean } = {},
) {
  pending = undefined;
  if (!allowsExpansion()) return;
  const bounds = surfaceBounds(source);
  if (bounds)
    pending = { destination, originKey, startedAt: performance.now(), bounds, revealTarget };
}

function expandCard(panel: HTMLElement, from: Keyframe, to: Keyframe) {
  finishActive?.();
  const root = document.documentElement;
  const surface = document.createElement('div');
  surface.className = 'course-expansion-surface';
  surface.setAttribute('aria-hidden', 'true');
  surface.inert = true;
  root.setAttribute('data-card-expansion', '');
  document.body.append(surface);

  const movement = surface.animate(
    [
      { ...from, opacity: 1 },
      { ...to, opacity: 0.96, offset: 0.78 },
      { ...to, opacity: 0 },
    ],
    { duration: 330, easing: 'cubic-bezier(0.22, 0.66, 0.22, 1)', fill: 'both' },
  );
  const reveal = panel.animate([{ opacity: 0.35 }, { opacity: 1 }], {
    duration: 245,
    easing: 'ease-out',
  });
  const stopOnPreferenceChange = () => {
    if (!allowsExpansion()) finish();
  };
  const preferenceObserver = new MutationObserver(stopOnPreferenceChange);
  function finish() {
    preferenceObserver.disconnect();
    document.removeEventListener('visibilitychange', stopOnPreferenceChange);
    movement.cancel();
    reveal.cancel();
    surface.remove();
    if (finishActive === finish) {
      finishActive = undefined;
      root.removeAttribute('data-card-expansion');
    }
  }
  finishActive = finish;
  preferenceObserver.observe(root, {
    attributes: true,
    attributeFilter: ['data-reduced-motion', 'data-theme-reveal'],
  });
  document.addEventListener('visibilitychange', stopOnPreferenceChange);
  movement.onfinish = finish;
  return finish;
}

/** Run against the real destination after rendering, including when a lesson loads asynchronously. */
export function useCardExpansion<T extends HTMLElement>(ready = true) {
  const ref = useRef<T>(null);
  const { pathname, search, key } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (!ready || !pending) return;
    const request = pending;
    // Direct links, history navigation and unrelated routes retain their usual behavior.
    if (navigationType === 'POP' || request.destination !== pathname + search) return;
    if (request.originKey === key) return;
    let finish: (() => void) | undefined;
    // Layout restores the route's scroll position before we sample the destination.
    const frame = requestAnimationFrame(() => {
      if (pending !== request) return;
      pending = undefined;
      if (performance.now() - request.startedAt > 1800 || !allowsExpansion() || !ref.current) {
        return;
      }
      const panel = ref.current;
      let target = surfaceBounds(panel);
      if (!target && request.revealTarget) {
        panel.scrollIntoView({ block: 'start', behavior: 'instant' });
        target = surfaceBounds(panel);
      }
      if (target) finish = expandCard(panel, request.bounds, target);
    });
    return () => {
      cancelAnimationFrame(frame);
      finish?.();
    };
  }, [key, navigationType, pathname, ready, search]);
  return ref;
}
