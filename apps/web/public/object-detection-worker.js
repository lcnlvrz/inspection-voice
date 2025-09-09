// Configure environment before importing modules
let AutoModel, AutoProcessor, RawImage, env

async function initializeTransformers() {
  console.log(
    '[ObjectDetection] Initializing Transformers.js with compatibility settings'
  )

  const transformers = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js'
  )

  AutoModel = transformers.AutoModel
  AutoProcessor = transformers.AutoProcessor
  RawImage = transformers.RawImage
  env = transformers.env

  // Configure backend for compatibility with older devices (iPhone 6s)
  env.backends.onnx.wasm.simd = false
  env.backends.onnx.wasm.proxy = false
  env.allowRemoteModels = true
  env.allowLocalModels = false

  // Additional fallback configuration
  env.backends.onnx.wasm.numThreads = 1

  console.log('[ObjectDetection] Environment configured for compatibility mode')
  console.log(
    '[ObjectDetection] Available backends:',
    Object.keys(env.backends)
  )
}

async function initializeWorker() {
  try {
    await initializeTransformers()
    self.postMessage({
      type: 'WORKER_READY',
    })
    console.log(
      '[ObjectDetection] Worker ready with Transformers.js initialized'
    )
  } catch (error) {
    console.error(
      '[ObjectDetection] Failed to initialize worker:',
      error.message
    )
    self.postMessage({
      type: 'WORKER_ERROR',
      error: `Failed to initialize: ${error.message}`,
    })
  }
}

let model = null
let processor = null
let isLoading = false

const loadModel = async (modelName = 'Xenova/gelan-c_all') => {
  if (!AutoModel || !AutoProcessor) {
    throw new Error('Transformers.js not initialized')
  }

  if (model && processor) {
    console.log(`[ObjectDetection] Model already loaded: ${modelName}`)
    return
  }
  if (isLoading) {
    console.log(
      `[ObjectDetection] Model loading already in progress: ${modelName}`
    )
    return
  }

  const startTime = performance.now()
  console.log(
    `[ObjectDetection] Starting model loading: ${modelName} at ${new Date().toISOString()}`
  )

  try {
    isLoading = true

    // Send loading status to main thread
    self.postMessage({
      type: 'MODEL_LOADING_START',
    })

    // Load model and processor
    const modelLoadStart = performance.now()
    console.log(`[ObjectDetection] Loading model from Hugging Face...`)
    model = await AutoModel.from_pretrained(modelName, {
      dtype: 'fp32',
    })
    const modelLoadTime = performance.now() - modelLoadStart
    console.log(
      `[ObjectDetection] Model loaded in ${modelLoadTime.toFixed(2)}ms`
    )

    const processorLoadStart = performance.now()
    console.log(`[ObjectDetection] Loading processor from Hugging Face...`)
    processor = await AutoProcessor.from_pretrained(modelName)
    const processorLoadTime = performance.now() - processorLoadStart
    console.log(
      `[ObjectDetection] Processor loaded in ${processorLoadTime.toFixed(2)}ms`
    )

    const totalLoadTime = performance.now() - startTime
    console.log(
      `[ObjectDetection] Model and processor fully loaded in ${totalLoadTime.toFixed(2)}ms`
    )

    // Send success status to main thread
    self.postMessage({
      type: 'MODEL_LOADED',
      executionTime: {
        modelLoad: modelLoadTime,
        processorLoad: processorLoadTime,
        total: totalLoadTime,
      },
    })

    isLoading = false
  } catch (error) {
    isLoading = false
    const totalLoadTime = performance.now() - startTime
    console.error(
      `[ObjectDetection] Model loading failed after ${totalLoadTime.toFixed(2)}ms:`,
      error.message
    )

    // Send error to main thread
    self.postMessage({
      type: 'MODEL_LOAD_ERROR',
      error: error.message,
      executionTime: {
        total: totalLoadTime,
      },
    })
  }
}

const detectObjects = async (imageData, threshold = 0.3, targetLabels = []) => {
  if (!model || !processor) {
    throw new Error('Model not loaded')
  }

  const startTime = performance.now()
  console.log(
    `[ObjectDetection] Starting inference at ${new Date().toISOString()}`
  )
  console.log(
    `[ObjectDetection] Image size: ${imageData.width}x${imageData.height}, threshold: ${threshold}, targetLabels:`,
    targetLabels
  )

  try {
    // Convert ImageData to RawImage
    const imageConversionStart = performance.now()
    const image = new RawImage(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height,
      4 // RGBA channels
    )
    const imageConversionTime = performance.now() - imageConversionStart
    console.log(
      `[ObjectDetection] Image conversion completed in ${imageConversionTime.toFixed(2)}ms`
    )

    // Process image
    const preprocessingStart = performance.now()
    const inputs = await processor(image)
    const preprocessingTime = performance.now() - preprocessingStart
    console.log(
      `[ObjectDetection] Image preprocessing completed in ${preprocessingTime.toFixed(2)}ms`
    )

    // Run inference
    const inferenceStart = performance.now()
    console.log(`[ObjectDetection] Running model inference...`)
    const { outputs } = await model(inputs)
    const predictions = outputs.tolist()
    const inferenceTime = performance.now() - inferenceStart
    console.log(
      `[ObjectDetection] Model inference completed in ${inferenceTime.toFixed(2)}ms`
    )

    // Post-process results
    const postprocessingStart = performance.now()
    const detections = []

    for (const [xmin, ymin, xmax, ymax, score, id] of predictions) {
      if (score < threshold) break

      const label = model.config.id2label[id]
      const detection = {
        label,
        confidence: score,
        bbox: [xmin, ymin, xmax, ymax],
      }

      detections.push(detection)
    }

    // Filter by target labels if specified
    const filteredDetections = detections

    const postprocessingTime = performance.now() - postprocessingStart
    const totalTime = performance.now() - startTime

    console.log(
      `[ObjectDetection] Post-processing completed in ${postprocessingTime.toFixed(2)}ms`
    )
    console.log(
      `[ObjectDetection] Found ${detections.length} total detections, ${filteredDetections.length} target detections`
    )
    console.log(
      `[ObjectDetection] Total inference completed in ${totalTime.toFixed(2)}ms`
    )

    return {
      allDetections: detections,
      targetDetections: filteredDetections,
      executionTime: {
        imageConversion: imageConversionTime,
        preprocessing: preprocessingTime,
        inference: inferenceTime,
        postprocessing: postprocessingTime,
        total: totalTime,
      },
    }
  } catch (error) {
    const totalTime = performance.now() - startTime
    console.error(
      `[ObjectDetection] Detection failed after ${totalTime.toFixed(2)}ms:`,
      error.message
    )
    throw new Error(`Detection failed: ${error.message}`)
  }
}

// Listen for messages from main thread
self.addEventListener('message', async (event) => {
  const { type, payload, id } = event.data
  console.log(
    `[ObjectDetection] Received message: ${type}`,
    id ? `(id: ${id})` : ''
  )

  try {
    switch (type) {
      case 'LOAD_MODEL':
        console.log(`[ObjectDetection] Processing model load request:`, payload)
        await loadModel(payload.modelName)
        break

      case 'DETECT_OBJECTS':
        console.log(
          `[ObjectDetection] Processing object detection request (id: ${id})`
        )
        if (!model || !processor) {
          console.error(
            `[ObjectDetection] Detection request failed - model not loaded (id: ${id})`
          )
          self.postMessage({
            type: 'DETECTION_ERROR',
            id,
            error: 'Model not loaded. Please load model first.',
          })
          return
        }

        const result = await detectObjects(
          payload.imageData,
          payload.threshold,
          payload.targetLabels
        )

        console.log(`[ObjectDetection] Sending detection results (id: ${id})`)
        self.postMessage({
          type: 'DETECTION_RESULT',
          id,
          result,
        })
        break

      case 'CHECK_MODEL_STATUS':
        console.log(
          `[ObjectDetection] Processing model status request (id: ${id})`
        )
        self.postMessage({
          type: 'MODEL_STATUS',
          id,
          status: {
            isLoaded: !!(model && processor),
            isLoading,
          },
        })
        break

      default:
        console.error(`[ObjectDetection] Unknown message type: ${type}`)
        self.postMessage({
          type: 'ERROR',
          id,
          error: `Unknown message type: ${type}`,
        })
    }
  } catch (error) {
    console.error(
      `[ObjectDetection] Error processing message ${type}:`,
      error.message
    )
    self.postMessage({
      type: 'ERROR',
      id,
      error: error.message,
    })
  }
})

// Initialize worker when it loads
initializeWorker()
