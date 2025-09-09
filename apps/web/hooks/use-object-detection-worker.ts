'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface Detection {
  label: string
  confidence: number
  bbox: [number, number, number, number]
}

export interface UseObjectDetectionWorkerOptions {
  videoElement?: HTMLVideoElement | null
  targetLabels?: string[]
  threshold?: number
  onDetection?: (detections: Detection[]) => void
  intervalMs?: number
  modelName?: string
}

export function useObjectDetectionWorker({
  videoElement,
  targetLabels = [],
  threshold = 0.3,
  onDetection,
  intervalMs = 1000,
  modelName = 'Xenova/gelan-c_all',
}: UseObjectDetectionWorkerOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const [isModelLoaded, setIsModelLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])
  const [isDetecting, setIsDetecting] = useState(false)
  const [isWorkerReady, setIsWorkerReady] = useState(false)

  console.log('isWorkerReady', isWorkerReady)

  const workerRef = useRef<Worker | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const messageIdRef = useRef<number>(0)
  const pendingRequestsRef = useRef<Map<number, (result: any) => void>>(
    new Map()
  )

  // Initialize worker
  const initializeWorker = useCallback(() => {
    if (workerRef.current) {
      console.log('worker already initialized')
      return
    }

    try {
      workerRef.current = new Worker('/object-detection-worker.js', {
        type: 'module',
      })

      console.log(
        'after instance worker',
        'workerRef.current',
        workerRef.current
      )

      workerRef.current.onmessage = (event) => {
        const { type, id, result, error, status } = event.data

        console.log('onmessage', event.data)

        switch (type) {
          case 'WORKER_READY':
            setIsWorkerReady(true)
            setError(null)
            break

          case 'WORKER_INIT_ERROR':
            setIsWorkerReady(false)
            setError(`Worker initialization failed: ${error}`)
            break

          case 'MODEL_LOADING_START':
            setIsLoading(true)
            setError(null)
            break

          case 'MODEL_LOADED':
            setIsModelLoaded(true)
            setIsLoading(false)
            setError(null)
            break

          case 'MODEL_LOAD_ERROR':
            setIsLoading(false)
            setIsModelLoaded(false)
            setError(error)
            break

          case 'DETECTION_RESULT':
            const callback = pendingRequestsRef.current.get(id)
            if (callback) {
              callback(result)
              pendingRequestsRef.current.delete(id)
            }
            break

          case 'DETECTION_ERROR':
            const errorCallback = pendingRequestsRef.current.get(id)
            if (errorCallback) {
              console.error('Detection error:', error)
              errorCallback(null)
              pendingRequestsRef.current.delete(id)
            }
            break

          case 'MODEL_STATUS':
            const statusCallback = pendingRequestsRef.current.get(id)
            if (statusCallback) {
              statusCallback(status)
              pendingRequestsRef.current.delete(id)
            }
            break

          case 'ERROR':
            console.error('Worker error:', error)
            setError(error)
            break
        }
      }

      workerRef.current.onerror = (error) => {
        console.error('Worker error:', error)
        setError('Worker initialization failed')
        setIsWorkerReady(false)
      }

      console.log('worker initialized')
    } catch (err) {
      console.log('Failed to initialize worker:', err)
      setError('Failed to initialize detection worker')
    }
  }, [])

  // Send message to worker and return a promise
  const sendWorkerMessage = useCallback(
    (type: string, payload: any = {}): Promise<any> => {
      return new Promise((resolve) => {
        if (!workerRef.current) {
          resolve(null)
          return
        }

        const id = ++messageIdRef.current
        pendingRequestsRef.current.set(id, resolve)

        workerRef.current.postMessage({
          type,
          id,
          payload,
        })
      })
    },
    []
  )

  // Load model in worker
  const loadModel = useCallback(async () => {
    console.log(
      'isWorkerReady',
      isWorkerReady,
      'isModelLoaded',
      isModelLoaded,
      'isLoading',
      isLoading
    )
    if (!isWorkerReady || isModelLoaded || isLoading) return

    try {
      await sendWorkerMessage('LOAD_MODEL', { modelName })
    } catch (err) {
      console.error('Failed to load model:', err)
      setError('Failed to load model')
    }
  }, [isWorkerReady, isModelLoaded, isLoading, modelName, sendWorkerMessage])

  // Capture frame from video as ImageData
  const captureFrameImageData = useCallback(
    (video: HTMLVideoElement): ImageData | null => {
      if (!video || video.readyState < 2) return null

      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
      }

      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      try {
        return ctx.getImageData(0, 0, canvas.width, canvas.height)
      } catch (err) {
        console.error('Error capturing frame:', err)
        return null
      }
    },
    []
  )

  // Detect objects using worker
  const detectObjects = useCallback(async (): Promise<Detection[]> => {
    if (!isWorkerReady || !isModelLoaded || !videoElement) {
      return []
    }

    try {
      const imageData = captureFrameImageData(videoElement)
      if (!imageData) return []

      const result = await sendWorkerMessage('DETECT_OBJECTS', {
        imageData: {
          data: Array.from(imageData.data),
          width: imageData.width,
          height: imageData.height,
        },
        threshold,
        targetLabels,
      })

      return result ? result.allDetections : []
    } catch (err) {
      console.error('Error during object detection:', err)
      return []
    }
  }, [
    isWorkerReady,
    isModelLoaded,
    videoElement,
    threshold,
    targetLabels,
    captureFrameImageData,
    sendWorkerMessage,
  ])

  // Run detection loop
  const runDetectionLoop = useCallback(async () => {
    if (!isModelLoaded || !videoElement) return

    try {
      const currentDetections = await detectObjects()
      setDetections(currentDetections)

      const relevantDetections = currentDetections

      if (relevantDetections.length > 0 && onDetection) {
        onDetection(relevantDetections)
      }
    } catch (err) {
      console.error('Error in detection loop:', err)
    }
  }, [isModelLoaded, videoElement, detectObjects, targetLabels, onDetection])

  // Start detection
  const startDetection = useCallback(() => {
    if (!isModelLoaded || isDetecting) return

    setIsDetecting(true)
    intervalRef.current = setInterval(runDetectionLoop, intervalMs)
  }, [isModelLoaded, isDetecting, runDetectionLoop, intervalMs])

  // Stop detection
  const stopDetection = useCallback(() => {
    setIsDetecting(false)
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  // Initialize worker on mount
  useEffect(() => {
    console.log('initializeWorker')
    initializeWorker()

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [initializeWorker])

  // Auto-start detection when conditions are met
  useEffect(() => {
    if (videoElement && isModelLoaded && !isDetecting) {
      startDetection()
    } else if (!videoElement && isDetecting) {
      stopDetection()
    }
  }, [videoElement, isModelLoaded, isDetecting, startDetection, stopDetection])

  // Auto-load model when worker is ready
  useEffect(() => {
    if (isWorkerReady && !isModelLoaded && !isLoading) {
      loadModel()
    }
  }, [isWorkerReady, isModelLoaded, isLoading, loadModel])

  return {
    isLoading,
    isModelLoaded,
    error,
    detections,
    isDetecting,
    isWorkerReady,
    loadModel,
    startDetection,
    stopDetection,
  }
}
