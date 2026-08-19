import { useEffect } from "react";
import {
  firebaseErrorMessage,
  getFirebase,
  subscribePublicRooms,
  subscribeRoomView,
} from "./firebaseClient";
import { useUiStore } from "../app/store";

export function useAuthentication(): void {
  const dispatch = useUiStore((state) => state.dispatch);
  useEffect(() => {
    dispatch({ type: "BOOT" });
    getFirebase()
      .then(() => dispatch({ type: "AUTH_OK" }))
      .catch((cause: unknown) =>
        dispatch({ type: "AUTH_FAILED", message: firebaseErrorMessage(cause) }),
      );
  }, [dispatch]);
}

export function usePublicRoomSubscription(enabled: boolean): void {
  const setPublicRooms = useUiStore((state) => state.setPublicRooms);
  const dispatch = useUiStore((state) => state.dispatch);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    subscribePublicRooms(
      (rooms) => alive && setPublicRooms(rooms),
      (error) => alive && dispatch({ type: "ERROR", message: firebaseErrorMessage(error) }),
    )
      .then((stop) => {
        if (alive) unsubscribe = stop;
        else stop();
      })
      .catch(
        (cause: unknown) =>
          alive && dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) }),
      );
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [dispatch, enabled, setPublicRooms]);
}

export function useRoomSubscription(roomId?: string): void {
  const dispatch = useUiStore((state) => state.dispatch);
  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    getFirebase()
      .then(({ user }) =>
        subscribeRoomView(
          roomId,
          user.uid,
          (room) => alive && dispatch({ type: "ROOM_VIEW", room }),
          (error) => alive && dispatch({ type: "ERROR", message: firebaseErrorMessage(error) }),
        ),
      )
      .then((stop) => {
        if (alive) unsubscribe = stop;
        else stop();
      })
      .catch(
        (cause: unknown) =>
          alive && dispatch({ type: "ERROR", message: firebaseErrorMessage(cause) }),
      );
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [dispatch, roomId]);
}
