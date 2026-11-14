import { useRef, useState } from 'react';

/**
 * Horizontal swipe for touch and pen (mouse users have buttons and keys).
 * A mostly-vertical drag is left to the browser so the page still scrolls,
 * and the click that a drag produces is swallowed so a swipe never also
 * counts as a tap.
 *
 * @returns { dx, handlers } where dx is the current drag offset in px
 */
export function useSwipe({ onSwipeLeft, onSwipeRight, threshold = 90 }) {
  const start = useRef(null); // { x, y, id, dragging }
  const swallowClick = useRef(false);
  const [dx, setDx] = useState(0);

  const finish = (event, commit) => {
    const s = start.current;
    start.current = null;
    if (!s?.dragging) return;
    swallowClick.current = true;
    setTimeout(() => {
      swallowClick.current = false; // in case no click follows the drag
    }, 0);
    const moved = event.clientX - s.x;
    setDx(0);
    if (commit && moved > threshold) onSwipeRight();
    else if (commit && moved < -threshold) onSwipeLeft();
  };

  const handlers = {
    onPointerDown(event) {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, dragging: false };
    },
    onPointerMove(event) {
      const s = start.current;
      if (!s || event.pointerId !== s.id) return;
      const moveX = event.clientX - s.x;
      const moveY = event.clientY - s.y;
      if (!s.dragging) {
        if (Math.abs(moveY) > 12 && Math.abs(moveY) > Math.abs(moveX)) {
          start.current = null; // a scroll, not a swipe
          return;
        }
        if (Math.abs(moveX) < 12) return;
        s.dragging = true;
        try {
          // Keep getting moves even if the finger leaves the card.
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // The pointer may already be gone; the swipe still works without capture.
        }
      }
      setDx(moveX);
    },
    onPointerUp: (event) => finish(event, true),
    onPointerCancel: (event) => finish(event, false),
    onClickCapture(event) {
      if (swallowClick.current) {
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };

  return { dx, threshold, handlers };
}
