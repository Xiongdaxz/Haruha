import { useEffect, useRef, useState } from "react";

interface RollingTextProps {
  animate: boolean;
  value: string;
  order: number;
  className?: string;
  sizerValue?: string;
  ariaLive?: "off" | "polite";
}

interface RollingTextTransition {
  id: number;
  from: string;
  to: string;
  direction: "forward" | "backward";
}

export function RollingText({
  animate,
  value,
  order,
  className = "",
  sizerValue,
  ariaLive = "off",
}: RollingTextProps) {
  const animateRef = useRef(animate);
  const currentRef = useRef({ order, value });
  const transitionIdRef = useRef(0);
  const [displayedValue, setDisplayedValue] = useState(value);
  const [transition, setTransition] = useState<RollingTextTransition | null>(null);

  animateRef.current = animate;

  useEffect(() => {
    const previous = currentRef.current;
    currentRef.current = { order, value };
    if (previous.value === value) return;

    setDisplayedValue(value);
    if (!animateRef.current) {
      setTransition(null);
      return;
    }

    transitionIdRef.current += 1;
    const transitionId = transitionIdRef.current;
    setTransition({
      id: transitionId,
      from: previous.value,
      to: value,
      direction: order >= previous.order ? "forward" : "backward",
    });

    const timer = window.setTimeout(() => {
      setTransition((current) => (current?.id === transitionId ? null : current));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [order, value]);

  return (
    <span className={`rolling-text-window ${className}`.trim()} aria-live={ariaLive}>
      <span className="rolling-text-sizer" aria-hidden="true">
        {sizerValue ?? value}
      </span>
      {transition ? (
        <>
          <span
            aria-hidden="true"
            className={`rolling-text-layer is-leaving roll-${transition.direction}`}
            key={`leaving-${transition.id}-${transition.from}`}
          >
            {transition.from}
          </span>
          <span
            className={`rolling-text-layer is-entering roll-${transition.direction}`}
            key={`entering-${transition.id}-${transition.to}`}
          >
            {transition.to}
          </span>
        </>
      ) : (
        <span className="rolling-text-layer">{displayedValue}</span>
      )}
    </span>
  );
}
