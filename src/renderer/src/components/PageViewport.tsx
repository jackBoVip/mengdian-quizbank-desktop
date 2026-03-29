import type { PropsWithChildren } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

export function PageViewport({ children }: PropsWithChildren): JSX.Element {
  const location = useLocation();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const scalable = location.pathname === '/';

  useLayoutEffect(() => {
    if (!scalable) {
      setScale(1);
      return;
    }

    let frameObserver: ResizeObserver | null = null;
    let stageObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let rafId = 0;

    const measure = (): void => {
      const frame = frameRef.current;
      const stage = stageRef.current;
      if (!frame || !stage) return;

      const contentWidth = Math.max(stage.scrollWidth, 1);
      const contentHeight = Math.max(stage.scrollHeight, 1);
      const widthScale = frame.clientWidth / contentWidth;
      const heightScale = frame.clientHeight / contentHeight;
      const nextScale = Math.min(1, widthScale, heightScale);

      setScale((current) => (Math.abs(current - nextScale) > 0.01 ? nextScale : current));
    };

    const scheduleMeasure = (): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    if (frameRef.current && stageRef.current) {
      frameObserver = new ResizeObserver(scheduleMeasure);
      frameObserver.observe(frameRef.current);

      stageObserver = new ResizeObserver(scheduleMeasure);
      stageObserver.observe(stageRef.current);

      mutationObserver = new MutationObserver(scheduleMeasure);
      mutationObserver.observe(stageRef.current, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });

      scheduleMeasure();
    }

    return () => {
      cancelAnimationFrame(rafId);
      frameObserver?.disconnect();
      stageObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [location.pathname, scalable]);

  return (
    <div ref={frameRef} className={`viewport-frame ${scalable ? '' : 'viewport-frame--static'}`.trim()}>
      <div
        ref={stageRef}
        className={`viewport-stage ${scalable ? '' : 'viewport-stage--static'}`.trim()}
        style={scalable ? { transform: `scale(${scale})` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
