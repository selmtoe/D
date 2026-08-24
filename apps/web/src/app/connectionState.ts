export function connectionStateOnBrowserOnline(
  hasActiveRoom: boolean,
  transportMode?: "webrtc" | "firebase" | "offline",
): "connected" | "reconnecting" {
  if (!hasActiveRoom) return "connected";
  return transportMode === "webrtc" || transportMode === "firebase" ? "connected" : "reconnecting";
}
