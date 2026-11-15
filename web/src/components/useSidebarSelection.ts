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

type Point = readonly [number, number];
type PillPaint = Pick<CSSStyleDeclaration, 'clipPath' | 'backgroundColor' | 'borderColor'>;

function outline(width: number, height: number, downward: boolean, stretched = false) {
  const center = width / 2;
  const radius = Math.min(width, height) / 2;
  const arc = radius * 0.5523;
  // One half of the outline, from the center of the tail to the center of the head.
  // Matching curve counts let the browser interpolate between the pill and the drop.
  const side: Point[] = stretched
    ? [
        [width * 0.51, 0],
        [width * 0.53, 0],
        [width * 0.54, height * 0.075],
        [width * 0.59, height * 0.21],
        [width * 0.68, height * 0.39],
        [width * 0.98, height * 0.45],
        [width * 0.98, height * 0.64],
        [width * 0.98, height * 0.88],
        [width * 0.79, height],
        [width * 0.56, height],
      ]
    : [
        [width - radius, 0],
        [width - radius + arc, 0],
        [width, radius - arc],
        [width, radius],
        [width, radius],
        [width, height - radius],
        [width, height - radius],
        [width, height - radius + arc],
        [width - radius + arc, height],
        [width - radius, height],
      ];
  // Reverse the reflected half so the first point stays on top when changing direction.
  const right = downward ? side : side.map(([x, y]): Point => [x, height - y]).reverse();
  const point = ([x, y]: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const curves = (points: Point[]) =>
    [1, 4, 7]
      .map(
        (i) =>
          `C ${points
            .slice(i, i + 3)
            .map(point)
            .join(' ')}`,
      )
      .join(' ');
  const left = right.map(([x, y]): Point => [width - x, y]).reverse();
  return `path("M ${point([center, 0])} L ${point(right[0])} ${curves(right)} L ${point(
    left[0],
  )} ${curves(left)} Z")`;
}

function movePill(pill: HTMLSpanElement, from: Position, to: Position, interrupted?: PillPaint) {
  const delta = to.y + to.height / 2 - (from.y + from.height / 2);
  const distance = Math.abs(delta);
  if (distance < 1 || Math.abs(from.width - to.width) >= 1) return;
  const downward = delta > 0;
  const fullHeight = to.height + Math.min(distance * 0.72, to.height * 1.2);
  const stretchAt = downward ? from.y : from.y + from.height - fullHeight;
  const arriveAt = downward ? to.y + to.height - fullHeight : to.y;
  const resting = {
    backgroundColor: 'var(--sidebar-selection-fill)',
    borderColor: 'var(--sidebar-selection-edge)',
  };
  const flowing = {
    clipPath: outline(to.width, fullHeight, downward, true),
    backgroundColor: 'var(--sidebar-selection-motion-fill)',
    borderColor: 'transparent',
  };
  return pill.animate(
    [
      {
        ...resting,
        ...verticalFrame(from.y, from.height),
        clipPath: interrupted?.clipPath || outline(from.width, from.height, downward),
        backgroundColor: interrupted?.backgroundColor || resting.backgroundColor,
        borderColor: interrupted?.borderColor || resting.borderColor,
        easing: 'cubic-bezier(.2,.65,.35,1)',
      },
      { ...flowing, ...verticalFrame(stretchAt, fullHeight), offset: 0.27, easing: 'ease-in-out' },
      { ...flowing, ...verticalFrame(arriveAt, fullHeight), offset: 0.68, easing: 'ease-out' },
      {
        ...resting,
        ...verticalFrame(to.y, to.height),
        clipPath: outline(to.width, to.height, downward),
      },
    ],
    { duration: Math.min(530, 380 + distance * 0.35) },
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
      const paint = from ? getComputedStyle(pill) : undefined;
      const interrupted =
        paint && paint.clipPath !== 'none'
          ? {
              clipPath: paint.clipPath,
              backgroundColor: paint.backgroundColor,
              borderColor: paint.borderColor,
            }
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
        CSS.supports('clip-path', 'path("M 0 0 L 1 1 Z")') &&
        !document.hidden &&
        !forcedColors.matches &&
        (root.dataset.reducedMotion === 'off' ||
          (!root.dataset.reducedMotion && !reducedMotion.matches))
      ) {
        running.current = movePill(pill, from, next, interrupted);
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
    document.addEventListener('visibilitychange', cancelMotion);
    return () => {
      resize.disconnect();
      preference.disconnect();
      forcedColors.removeEventListener('change', cancelMotion);
      document.removeEventListener('visibilitychange', cancelMotion);
    };
  }, [selectedPath, narrow, collapsed]);

  useLayoutEffect(() => () => running.current?.cancel(), []);
  return { navigationRef, pillRef };
}
