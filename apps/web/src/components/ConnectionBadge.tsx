import type { ConnectionState } from "../app/model";
import { firebaseMode } from "../network/firebaseClient";

const labels: Record<ConnectionState, string> = {
  connecting: "接続中",
  connected: "接続済み",
  reconnecting: "再接続中",
  grace: "切断猶予中",
  offline: "オフライン",
};
export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection-badge ${state}`} role="status">
      <i aria-hidden="true" />
      {labels[state]} · {firebaseMode.emulator ? "Emulator" : firebaseMode.projectId}
    </span>
  );
}
