'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RotateCcw, Download, Camera, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useVoiceAgent } from '@/hooks/use-voice-agent'
import { useInspection } from '@/components/providers/inspection-provider'
import { analyzeImage } from '@/app/server'

interface MediaDeviceInfo {
  deviceId: string
  label: string
}

export default function VideoRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string>('')
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [capturedImages, setCapturedImages] = useState<string[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameIntervalRef = useRef<number | null>(null)

  const [validInspectionImages, setValidInspectionImages] = useState<
    {
      side: 'front' | 'back' | 'left' | 'right'
      base64Image: string
    }[]
  >([])

  const [showFlash, setShowFlash] = useState(false)

  console.log('validInspectionImages', validInspectionImages)

  const inspection = useInspection()

  // Get available cameras
  const getAvailableCameras = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
        }))

      setCameras(videoDevices)
      if (videoDevices.length > 0 && !selectedCameraId) {
        setSelectedCameraId(videoDevices[0]?.deviceId || '')
      }
    } catch (error) {
      console.error('[v0] Error getting cameras:', error)
      toast.error('Unable to access camera devices')
    }
  }

  // Start camera stream
  const startCamera = async (deviceId?: string) => {
    try {
      setIsLoading(true)

      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }

      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: true,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      setHasPermission(true)
      await getAvailableCameras()
    } catch (error) {
      console.error('Error starting camera:', error)
      setHasPermission(false)
      toast.error('Camera Access Denied')
    } finally {
      setIsLoading(false)
    }
  }

  // Switch camera
  const switchCamera = async () => {
    if (cameras.length <= 1) return

    const currentIndex = cameras.findIndex(
      (cam) => cam.deviceId === selectedCameraId
    )
    const nextIndex = (currentIndex + 1) % cameras.length
    const nextCamera = cameras[nextIndex]

    setSelectedCameraId(nextCamera?.deviceId || '')

    const wasRecording = isRecording

    try {
      setIsLoading(true)

      // Stop current MediaRecorder if recording, but don't process the data
      if (wasRecording && mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null
        mediaRecorderRef.current.onstop = null
        mediaRecorderRef.current.stop()
        setIsRecording(false)
      }

      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }

      const constraints: MediaStreamConstraints = {
        //@ts-ignore
        video: { deviceId: { exact: nextCamera.deviceId } },
        audio: true,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      // If we were recording, start recording again with new stream
      if (wasRecording) {
        setTimeout(() => {
          startRecording()
        }, 100)
      }

      toast.info(`Now using: ${nextCamera?.label || ''}`)
    } catch (error) {
      console.error('[v0] Error switching camera:', error)
      toast.error('Unable to switch camera')
    } finally {
      setIsLoading(false)
    }
  }

  // Start recording
  const startRecording = () => {
    if (!streamRef.current) return

    try {
      chunksRef.current = []

      // Try different MIME types in order of preference for compatibility
      const supportedMimeTypes = [
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=h264',
      ]

      let selectedMimeType = ''
      for (const mimeType of supportedMimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType
          break
        }
      }

      const mediaRecorder = selectedMimeType
        ? new MediaRecorder(streamRef.current, { mimeType: selectedMimeType })
        : new MediaRecorder(streamRef.current)

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const mimeType = selectedMimeType || 'video/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const url = URL.createObjectURL(blob)
        setRecordedVideoUrl(url)
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error('[v0] Error starting recording:', error)
      toast.error('Unable to start recording')
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)

      toast.info('Recording Stopped')
    }
  }

  // Reset to start over
  const resetRecording = () => {
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl)
      setRecordedVideoUrl(null)
    }
    // Clear captured images
    setCapturedImages([])
    startCamera(selectedCameraId)
  }

  // Initialize camera on mount
  useEffect(() => {
    startCamera()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (recordedVideoUrl) {
        URL.revokeObjectURL(recordedVideoUrl)
      }
      stopFrameProcessing()
    }
  }, [])

  // Capture image from video stream
  const captureImage = async () => {
    if (!videoRef.current || !canvasRef.current) return null

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')

    if (!context) return null

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    // Draw current video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Convert to image data URL
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8)

    return {
      base64Image: imageDataUrl,
    }
  }

  // Start frame processing for automatic capture
  const startFrameProcessing = () => {
    if (frameIntervalRef.current) return

    frameIntervalRef.current = window.setInterval(() => {
      // Here you can add logic to automatically capture based on frame analysis
      // For now, we'll capture every 5 seconds as an example
      // In a real implementation, you'd analyze the frame for proper vehicle positioning
      captureImage()
    }, 5000)
  }

  // Stop frame processing
  const stopFrameProcessing = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current)
      frameIntervalRef.current = null
    }
  }

  const triggerFlash = () => {
    setShowFlash(true)
    setTimeout(() => setShowFlash(false), 150)
  }

  const { startAgent, session } = useVoiceAgent({
    captureImage,
    onSaveValidImage: ({ side, base64Image }) =>
      setValidInspectionImages((prev) => [
        ...(prev || []),
        { side, base64Image },
      ]),
    onPhotoTaken: triggerFlash,
  })

  useEffect(() => {
    if (!isLoading) {
      startAgent()
    }
  }, [isLoading])

  // Watch for inspection start to begin image capture
  useEffect(() => {
    if (inspection.inspectionStarted) {
      startFrameProcessing()
      toast.info('Inspection started - automatic image capture enabled')
    } else {
      stopFrameProcessing()
    }

    return () => {
      stopFrameProcessing()
    }
  }, [inspection.inspectionStarted])

  if (hasPermission === false) {
    return (
      <div className='flex flex-col items-center justify-center min-h-screen p-4'>
        <Card className='p-6 text-center max-w-sm w-full'>
          <AlertCircle className='w-12 h-12 text-muted mx-auto mb-4' />
          <h2 className='text-lg font-semibold mb-2'>Camera Access Required</h2>
          <p className='text-sm text-muted-foreground mb-4'>
            Please allow camera access to use the video recorder
          </p>
          <Button onClick={() => startCamera()} className='w-full'>
            <Camera className='w-4 h-4 mr-2' />
            Enable Camera
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className='fixed inset-0 h-dvh w-full overflow-hidden'>
      <div className='absolute inset-0'>
        <video
          ref={videoRef}
          className='w-full h-full object-cover'
          autoPlay
          muted
          playsInline
        />

        {isLoading && (
          <div className='absolute inset-0 bg-black/50 flex items-center justify-center'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-white'></div>
          </div>
        )}

        {/* Hidden canvas for image capture */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Flash overlay */}
        {showFlash && (
          <div
            className='absolute inset-0 bg-white animate-pulse pointer-events-none'
            style={{ animationDuration: '150ms', animationIterationCount: '1' }}
          />
        )}
      </div>

      <div className='absolute bottom-0 left-0 right-0 bg-white/10 backdrop-blur-xl border-t border-white/20 shadow-2xl'>
        <div className='p-4 pb-6'>
          <div className='flex items-center justify-end'>
            {!recordedVideoUrl ? (
              <Button
                onClick={switchCamera}
                variant='secondary'
                size='sm'
                className='bg-white/15 hover:bg-white/25 text-white border border-white/30 backdrop-blur-md shadow-lg transition-all duration-200 hover:shadow-xl'
                disabled={cameras.length <= 1 || isLoading}
              >
                <RotateCcw className='w-4 h-4' />
              </Button>
            ) : (
              <>
                <Button
                  onClick={resetRecording}
                  variant='secondary'
                  size='sm'
                  className='bg-white/15 hover:bg-white/25 text-white border border-white/30 backdrop-blur-md shadow-lg mr-3 transition-all duration-200 hover:shadow-xl'
                >
                  <Camera className='w-4 h-4 mr-2' />
                  Record Again
                </Button>
              </>
            )}
          </div>

          {cameras.length > 0 && (
            <div className='text-center mt-3'>
              <p className='text-xs text-white/80 font-medium'>
                {cameras.find((cam) => cam.deviceId === selectedCameraId)
                  ?.label || 'Camera'}
                {cameras.length > 1 && ` (${cameras.length} available)`}
              </p>
              {capturedImages.length > 0 && (
                <p className='text-xs text-white/90 font-semibold mt-1'>
                  Images captured: {capturedImages.length}
                </p>
              )}
              {inspection.inspectionStarted && (
                <p className='text-xs text-green-400 font-medium mt-1'>
                  ✓ Inspection in progress
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
