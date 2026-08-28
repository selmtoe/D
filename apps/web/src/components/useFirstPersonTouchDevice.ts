import { useEffect, useState } from "react";

export function useFirstPersonTouchDevice(): boolean {
  const [touchDevice, setTouchDevice] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(pointer: coarse), (max-width: 720px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse), (max-width: 720px)");
    const update = () => setTouchDevice(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return touchDevice;
}
