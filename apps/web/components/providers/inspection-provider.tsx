'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  useInspectionStore,
  type InspectionState,
} from '@/lib/stores/inspection-store'

export interface ExtendedInspectionState extends InspectionState {}

const InspectionContext = createContext<InspectionState | null>(null)

export function InspectionProvider({ children }: { children: ReactNode }) {
  const store = useInspectionStore()

  return (
    <InspectionContext.Provider value={store}>
      {children}
    </InspectionContext.Provider>
  )
}

export function useInspection() {
  const context = useContext(InspectionContext)
  if (!context) {
    throw new Error('useInspection must be used within InspectionProvider')
  }
  return context
}
