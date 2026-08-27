import { create } from "zustand";
import type { AppEvent, AppState, CardView, PublicRoom } from "./model";
import { initialAppState, retainSelectedCardIds, transition } from "./stateMachine";
import { getStoredValue, setStoredValue } from "./browserStorage";

interface UiState {
  app: AppState;
  publicRooms: PublicRoom[];
  selectedCardIds: string[];
  lowPower: boolean;
  mobileMode: boolean;
  reducedMotion: boolean;
  soundMuted: boolean;
  logOpen: boolean;
  editorOpen: boolean;
  activeDialog: "blind-confirm" | "rules" | undefined;
  dispatch: (event: AppEvent) => void;
  setPublicRooms: (rooms: PublicRoom[]) => void;
  toggleCard: (card: CardView) => void;
  clearSelection: () => void;
  setSettings: (
    settings: Partial<
      Pick<
        UiState,
        "lowPower" | "mobileMode" | "soundMuted" | "logOpen" | "editorOpen" | "activeDialog"
      >
    >,
  ) => void;
}

const mediaReduced =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useUiStore = create<UiState>((set) => ({
  app: initialAppState,
  publicRooms: [],
  selectedCardIds: [],
  lowPower: getStoredValue("local", "daifugo-low-power") === "true",
  mobileMode: getStoredValue("local", "daifugo-mobile-mode") === "true",
  reducedMotion: mediaReduced,
  soundMuted: getStoredValue("local", "daifugo-muted") === "true",
  logOpen: false,
  editorOpen: false,
  activeDialog: undefined,
  dispatch: (event) =>
    set((state) => ({
      app: transition(state.app, event),
      selectedCardIds:
        event.type === "ROOM_VIEW"
          ? retainSelectedCardIds(state.selectedCardIds, state.app.room, event.room)
          : event.type === "LEAVE_ROOM" || event.type === "LEAVE_LOCAL_ROOM"
            ? []
            : state.selectedCardIds,
    })),
  setPublicRooms: (publicRooms) => set({ publicRooms }),
  toggleCard: (card) =>
    set((state) => ({
      selectedCardIds: state.selectedCardIds.includes(card.id)
        ? state.selectedCardIds.filter((id) => id !== card.id)
        : [...state.selectedCardIds, card.id],
    })),
  clearSelection: () => set({ selectedCardIds: [] }),
  setSettings: (settings) => {
    if (settings.lowPower !== undefined)
      setStoredValue("local", "daifugo-low-power", String(settings.lowPower));
    if (settings.mobileMode !== undefined)
      setStoredValue("local", "daifugo-mobile-mode", String(settings.mobileMode));
    if (settings.soundMuted !== undefined)
      setStoredValue("local", "daifugo-muted", String(settings.soundMuted));
    set(settings);
  },
}));
