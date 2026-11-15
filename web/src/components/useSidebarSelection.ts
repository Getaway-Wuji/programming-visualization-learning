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

function verticalFrame(y: number, height: number) {
  return { transform: `translateY(${y}px)`, height: `${height}px` };
}

function movePill(pill: HTMLSpanElement, from: Position, to: Position) {
  const delta = to.y - from.y;
  const distance = Math.abs(delta);
  if (distance < 1 || Math.abs(from.width - to.width) >= 1) return;
  // Extend the leading edge first. Move it to the destination, then catch up with the tail.
  const fullHeight = Math.max(from.height, to.height + Math.min(distance, to.height * 1.45));
  const stretchAt = delta > 0 ? from.y : from.y + from.height - fullHeight;
  const arriveAt = delta > 0 ? to.y + to.height - fullHeight : to.y;
  return pill.animate(
    [
      { ...verticalFrame(from.y, from.height), easing: 'cubic-bezier(.22,.65,.4,1)' },
      { ...verticalFrame(stretchAt, fullHeight), offset: 0.28, easing: 'ease-in-out' },
      { ...verticalFrame(arriveAt, fullHeight), offset: 0.67, easing: 'ease-out' },
      verticalFrame(to.y, to.height),
    ],
    { duration: Math.min(540, 380 + distance * 0.45) },
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
      const frame = verticalFrame(next.y, next.height);
      pill.style.left = `${next.x}px`;
      pill.style.width = `${next.width}px`;
      pill.style.height = frame.height;
      pill.style.transform = frame.transform;
      navigation.dataset.selectionPill = 'true';

      if (
        from &&
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
    return () => {
      resize.disconnect();
      preference.disconnect();
      forcedColors.removeEventListener('change', cancelMotion);
    };
  }, [selectedPath, narrow, collapsed]);

  useLayoutEffect(() => () => running.current?.cancel(), []);
  return { navigationRef, pillRef };
}
