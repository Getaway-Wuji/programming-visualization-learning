import { useLayoutEffect, useRef } from 'react';

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

function positionInNavigation(element: Element, navigationBounds: DOMRect): Position {
  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.left - navigationBounds.left,
    y: bounds.top - navigationBounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function samePosition(left: Position, right: Position) {
  return (
    Math.abs(left.x - right.x) < 0.5 &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function selectionFrame(position: Position) {
  return {
    transform: `translate(${position.x}px, ${position.y}px)`,
    width: `${position.width}px`,
    height: `${position.height}px`,
  };
}

function movePill(pill: HTMLSpanElement, from: Position, to: Position) {
  if (samePosition(from, to)) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // Limit the rebound to a few pixels even when traversing the entire sidebar.
  const settle = Math.min(3, distance * 0.045) / (distance || 1);
  return pill.animate(
    [
      { ...selectionFrame(from), easing: 'cubic-bezier(.22,.7,.35,1)' },
      {
        ...selectionFrame({ ...to, x: to.x + dx * settle, y: to.y + dy * settle }),
        offset: 0.82,
        easing: 'ease-out',
      },
      selectionFrame(to),
    ],
    { duration: Math.min(370, 255 + distance * 0.28) },
  );
}

export function useSidebarSelection(
  selectedPath: string | undefined,
  narrow: boolean,
  collapsed: boolean,
) {
  const navigationRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const running = useRef<Animation>(undefined);
  const previous = useRef<{ selectedPath: string | undefined; collapsed: boolean }>(undefined);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const pill = pillRef.current;
    if (!navigation || !pill) return;
    const prior = previous.current;
    previous.current = { selectedPath, collapsed };
    const target = navigation.querySelector('[aria-current="page"]');
    if (narrow || !target) {
      running.current?.cancel();
      delete navigation.dataset.selectionPill;
      return;
    }

    const root = document.documentElement;
    const forcedColors = matchMedia('(forced-colors: active)');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let destination: Position | undefined;
    const align = (animate: boolean, force = false) => {
      const bounds = navigation.getBoundingClientRect();
      const next = positionInNavigation(target, bounds);
      if (!force && destination && samePosition(next, destination)) return;
      destination = next;

      const from =
        animate && navigation.dataset.selectionPill === 'true'
          ? positionInNavigation(pill, bounds)
          : undefined;
      running.current?.cancel();
      Object.assign(pill.style, selectionFrame(next));
      navigation.dataset.selectionPill = 'true';

      if (
        from &&
        typeof pill.animate === 'function' &&
        !document.hidden &&
        !forcedColors.matches &&
        (root.dataset.reducedMotion === 'off' ||
          (!root.dataset.reducedMotion && !reducedMotion.matches))
      ) {
        running.current = movePill(pill, from, next);
      }
    };

    align(
      Boolean(
        prior?.selectedPath && prior.selectedPath !== selectedPath && prior.collapsed === collapsed,
      ),
    );
    const resize = new ResizeObserver(() => align(false));
    resize.observe(navigation);
    resize.observe(target);
    const cancelMotion = () => align(false, true);
    const preference = new MutationObserver(cancelMotion);
    preference.observe(root, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    forcedColors.addEventListener('change', cancelMotion);
    reducedMotion.addEventListener('change', cancelMotion);
    document.addEventListener('visibilitychange', cancelMotion);
    return () => {
      resize.disconnect();
      preference.disconnect();
      forcedColors.removeEventListener('change', cancelMotion);
      reducedMotion.removeEventListener('change', cancelMotion);
      document.removeEventListener('visibilitychange', cancelMotion);
    };
  }, [selectedPath, narrow, collapsed]);

  useLayoutEffect(() => () => running.current?.cancel(), []);
  return { navigationRef, pillRef };
}
