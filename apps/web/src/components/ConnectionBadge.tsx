import type { ConnectionState } from "../app/model";
import { firebaseMode } from "../network/firebaseClient";

const labels: Record<ConnectionState, string> = {
  connecting: "接続中",
  connected: "接続済み",
  reconnecting: "再接続中",
  grace: "切断猶予中",
  offline: "オフライン",
};
export function ConnectionBadge({
  state,
  localOnly = false,
  deferred = false,
}: {
  state: ConnectionState;
  localOnly?: boolean;
  deferred?: boolean;
}) {
  if (deferred)
    return (
      <span className="connection-badge deferred" role="status">
        <i aria-hidden="true" />
        ロビー入場時にオンライン接続
      </span>
    );
  return (
    <span className={`connection-badge ${state}`} role="status">
      <i aria-hidden="true" />
      {labels[state]} ·{" "}
      {localOnly ? "ローカルCPU" : firebaseMode.emulator ? "Emulator" : firebaseMode.projectId}
    </span>
  );
}
