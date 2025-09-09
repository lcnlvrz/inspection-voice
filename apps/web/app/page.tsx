import VideoRecorder from "@/components/video-recorder"
import { InspectionProvider } from "@/components/providers/inspection-provider"

export default function Home() {
  return (
    <InspectionProvider>
      <main className="min-h-screen py-8">
        <VideoRecorder />
      </main>
    </InspectionProvider>
  )
}
