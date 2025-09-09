import { create } from 'zustand'

export interface InspectionState {
  inspectionStarted: boolean
  startInspection: () => void
}

export const useInspectionStore = create<InspectionState>((set) => ({
  inspectionStarted: false,
  startInspection: () => set({ inspectionStarted: true }),
}))
