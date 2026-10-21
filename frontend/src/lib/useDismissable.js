import { useCallback, useEffect, useRef, useState } from "react";

// Matches modal-backdrop-out / modal-panel-out in styles.css.
const EXIT_MS = 160;

/*
  Keeps a modal mounted just long enough for its exit animation to run. The
  .is-closing styles already existed but nothing ever applied them, so modals
  faded in and then vanished instantly.

  Returns [isClosing, dismiss, cancelDismiss]. Put `is-closing` on the backdrop
  and panel when isClosing is true, and call dismiss() wherever you previously
  closed directly. cancelDismiss() calls off a dismissal already in flight, for
  something reopenable like a menu; a modal can ignore it.

  Pass { respectReducedMotion: false } for a small local panel whose exit
  should still run when the OS asks for reduced motion. The default is true,
  which is right for a modal flying up over the whole screen.
*/
export default function useDismissable(onDismissed, { respectReducedMotion = true } = {}) {
  const [isClosing, setIsClosing] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const dismiss = useCallback(() => {
    if (timeoutRef.current) return; // already closing

    if (
      respectReducedMotion &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      onDismissed();
      return;
    }

    setIsClosing(true);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setIsClosing(false);
      onDismissed();
    }, EXIT_MS);
  }, [onDismissed, respectReducedMotion]);

  // Reopening during the exit animation has to stop the pending onDismissed,
  // or the reopened panel closes itself a moment later.
  const cancelDismiss = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setIsClosing(false);
  }, []);

  return [isClosing, dismiss, cancelDismiss];
}
