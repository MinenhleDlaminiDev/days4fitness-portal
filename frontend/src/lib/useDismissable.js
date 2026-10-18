import { useCallback, useEffect, useRef, useState } from "react";

// Matches modal-backdrop-out / modal-panel-out in styles.css.
const EXIT_MS = 160;

/*
  Keeps a modal mounted just long enough for its exit animation to run. The
  .is-closing styles already existed but nothing ever applied them, so modals
  faded in and then vanished instantly.

  Returns [isClosing, dismiss]. Put `is-closing` on the backdrop and panel when
  isClosing is true, and call dismiss() wherever you previously closed directly.
*/
export default function useDismissable(onDismissed) {
  const [isClosing, setIsClosing] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const dismiss = useCallback(() => {
    if (timeoutRef.current) return; // already closing

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDismissed();
      return;
    }

    setIsClosing(true);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setIsClosing(false);
      onDismissed();
    }, EXIT_MS);
  }, [onDismissed]);

  return [isClosing, dismiss];
}
