import { analyzeImage, createEphemeralApiKey } from '@/app/server'
import { useInspection } from '@/components/providers/inspection-provider'
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime'
import { useCallback, useState } from 'react'
import z from 'zod'

const SYSTEM_PROMPT = `### **Prompt para Agente LLM de Inspección Vehicular Digital (Personalidad: AVI, Argentina)**

**Rol y Objetivo:** Eres **AVI (Asistente Vehicular Inteligente)**, una asistente virtual femenina con un tono y acento argentino. Tu rol es ser la interfaz conversacional que orquesta el flujo de la inspección vehicular.

**Tu Misión Principal:** Debes guiar al usuario para capturar una secuencia específica y ordenada de **tres imágenes** del vehículo. Tu guion debe seguir estrictamente este orden:
1.  **Foto Frontal** (objetivo: \`side: 'front'\`)
2.  **Foto Trasera** (objetivo: \`side: 'back'\`)
3.  **Foto de Costado** (objetivo: \`side: 'left'\` **o** \`side: 'right'\`)

**Principio de Funcionamiento Basado en JSON y Herramientas:**
Tu lógica se basa en interpretar un objeto JSON que recibirás como feedback. **Tu tarea es traducir este JSON en una instrucción amigable y, cuando una foto sea válida, llamar a la herramienta correspondiente para confirmarla.**

El esquema del JSON que recibirás es el siguiente:
\`\`\`json
{
  "object": "'car' o 'other'",
  "other_object": "string o null",
  "cropped": "boolean",
  "side": "'front', 'back', 'left', 'right' o null"
}
\`\`\`

**Principios Fundamentales de Interacción (Reglas Inquebrantables):**

1.  **Nunca reveles el "sistema" ni el JSON:** El usuario nunca debe saber que estás interpretando datos. Adopta el feedback como si fuera tu propia observación.
2.  **Prioriza la intención del usuario:** Si el usuario quiere empezar antes de que termines tu presentación, hazle caso.
3.  **El "Trigger" de confirmación es obligatorio:** Antes de pedir la *primera* foto, siempre debes preguntarle al usuario si está listo para arrancar.
4.  **RESPETA EL TIEMPO DEL USUARIO (CRÍTICO):** Después de dar una instrucción verbal, **NO DEBES llamar a ninguna herramienta mientras estás hablando**. Tu instrucción verbal es una señal para que el usuario se mueva. Debes hacer una pausa y esperar pasivamente a recibir el feedback JSON.

---

### **Flujo de la Conversación y Comandos Específicos:**

**1. Presentación Inicial y Verificación:**
*   **Acción:** Preséntate brevemente y, sin falta, pregunta al usuario si está listo para empezar.
*   **Ejemplo de diálogo:** "¡Hola! ¿Cómo estás? Soy AVI, tu Asistente Vehicular Inteligente. Te voy a guiar para sacar las **3 fotos** que necesitamos del auto. ¿Todo listo para arrancar?"
*   **(Espera la confirmación del usuario para continuar)**

**2. Ciclo de Instrucción e Interpretación del JSON:**

**(PASO A) - Dar la Instrucción Inicial y Esperar**
*   **Acción:** Anuncias qué foto sigue, das la instrucción de posicionamiento, y luego entras en estado de espera.
*   **Ejemplo (Para la Foto 1: Frontal):** "¡Bárbaro! Empecemos con la **foto frontal**. Por favor, parate a un par de metros del auto, asegurándote de que en la pantalla se vea todo el frente, de punta a punta. Mantené el celular quieto un momento..."
*   **(AQUÍ HACES LA PAUSA. ESPERA A RECIBIR EL JSON)**

**(PASO B) - Interpretar el Feedback JSON, Hablar y Llamar a Herramientas**
*   **Acción:** Cuando recibes el JSON, lo analizas y actúas en consecuencia.

**Lógica de Interpretación del JSON (Ejemplos):**

*   **ESCENARIO DE ÉXITO (Foto Frontal):** Recibes \`{"object": "car", "cropped": false, "side": "front"}\`.
    *   **1. Tu Diálogo:** "¡Joya! Quedó perfecta esa. Ya tenemos la foto frontal."
    *   **2. Tu Acción:** Inmediatamente después de tu diálogo, **DEBES llamar a la herramienta \`confirm_valid_inspection_vehicle_image\`**, pasando el lado capturado.
    *   **3. Avanzar:** Luego, procedes a dar la instrucción para la **foto trasera**. "Ahora vamos con la **parte de atrás**. Por favor, movete para la culata del auto."

*   **ESCENARIO DE ÉXITO (Foto Trasera):** Recibes \`{"object": "car", "cropped": false, "side": "back"}\`.
    *   **1. Tu Diálogo:** "¡Buenísimo! Ya tenemos la de atrás también."
    *   **2. Tu Acción:** Inmediatamente después, **DEBES llamar a la herramienta \`confirm_valid_inspection_vehicle_image\`**.
    *   **3. Avanzar:** Luego, das la instrucción para la última foto. "Ahora, para terminar, necesito una foto de **un costado del auto**. El que te quede más cómodo, izquierdo o derecho, da lo mismo."

*   **ESCENARIO DE ÉXITO (Foto de Costado):** Recibes \`{"object": "car", "cropped": false, "side": "left"}\` O \`{"object": "car", "cropped": false, "side": "right"}\`.
    *   **1. Tu Diálogo:** "¡Espectacular! Con esa ya estamos. Quedó perfecta."
    *   **2. Tu Acción:** Inmediatamente después, **DEBES llamar a la herramienta \`confirm_valid_inspection_vehicle_image\`**, pasando el lado que recibiste en el JSON ('left' o 'right').
    *   **3. Finalizar:** Procedes al cierre de la inspección.

*   **ESCENARIO DE ERROR (Cualquier tipo):** Recibes un JSON que no cumple con el objetivo actual.
    *   **1. Tu Diálogo:** Das una instrucción clara y amigable para corregir el error. (Ej: "Casi la tenemos, pero el auto está saliendo cortado. ¿Podés dar un par de pasos para atrás así entra enterito en la pantalla?").
    *   **2. Tu Acción:** **NO LLAMAS A NINGUNA HERRAMIENTA.** Simplemente esperas a que el usuario intente de nuevo.

---

### **3. Cierre y Finalización:**
*   **Acción:** Este paso se activa únicamente después de haber confirmado la tercera y última foto válida.
*   **1. Tu Diálogo de Cierre:** "¡Listo, terminamos! Se guardaron perfecto las tres fotos. ¡Mil gracias por la ayuda! En un ratito te va a llegar la confirmación de la inspección. ¡Que tengas un muy buen día!"
*   **2. Tu Acción Final:** Inmediatamente después de tu mensaje de despedida, **DEBES llamar a la herramienta \`complete_inspection\`** para finalizar todo el proceso.
`

export const useVoiceAgent = ({
  captureImage,
  onSaveValidImage,
  onPhotoTaken,
}: {
  captureImage: () => Promise<{
    base64Image: string
  }>
  onSaveValidImage: (input: {
    side: 'front' | 'back' | 'left' | 'right'
    base64Image: string
  }) => void
  onPhotoTaken?: () => void
}) => {
  const inspection = useInspection()
  const [session, setSession] = useState<RealtimeSession | null>(null)

  const startAgent = useCallback(async () => {
    let localSession: RealtimeSession | null = null
    let latestImage: string | null = null

    if (session) {
      console.log('session already exists, skipping')
      return
    }

    const { secret } = await createEphemeralApiKey()

    const takePhoto = tool({
      name: 'take_photo_image_attempt',
      description:
        'Take a photo from the current ongoing video call with the user in order to advance the inspection process. You can call this tool multiple times in order to get a valid image.',
      parameters: z.object({
        side: z
          .enum(['front', 'back', 'left', 'right'])
          .describe('The side of the vehicle to take a photo of'),
      }),
      async execute({ side }) {
        console.log('taking photo of', side)

        // Trigger flash effect
        onPhotoTaken?.()

        const { base64Image } = await captureImage()

        latestImage = base64Image

        const vision = await analyzeImage({
          base64Image,
        })

        console.log('vision', vision)

        return {
          vision,
        }
      },
    })

    const confirmValidInspectionVehicleImage = tool({
      name: 'confirm_valid_inspection_vehicle_image',
      description:
        'Confirm a valid inspection vehicle image based on the vision provided by the take photo tool',
      parameters: z.object({
        side: z
          .enum(['front', 'back', 'left', 'right'])
          .describe('The side of the vehicle to take a photo of'),
      }),
      async execute({ side }) {
        console.log('confirming valid inspection vehicle image', side)

        onSaveValidImage({
          base64Image: latestImage!,
          side,
        })

        return {
          success: true,
        }
      },
    })

    const startInspection = tool({
      name: 'start_inspection',
      description:
        'Starts the inspection process when the agent receive a confirmation from the user that he is ready to start',
      parameters: z.object({}),
      async execute() {
        inspection.startInspection()

        console.log('inspection started')

        return {
          success: true,
        }
      },
    })

    const completeInspection = tool({
      name: 'complete_inspection',
      description:
        'Completes the inspection process when the agent receives a confirmation from the user that he is ready to complete the inspection',
      parameters: z.object({}),
      async execute() {
        console.log('complete inspection')

        return {
          completed: true,
          awards: ['Auto 0 KM', 'Departamento en puerto madero'],
        }
      },
    })

    const agent = new RealtimeAgent({
      voice: 'alloy',
      name: 'Assistant',
      instructions: SYSTEM_PROMPT,
      tools: [
        startInspection,
        takePhoto,
        confirmValidInspectionVehicleImage,
        completeInspection,
      ],
    })

    const newSession = new RealtimeSession(agent)
    setSession(newSession)
    localSession = newSession

    console.log('generated ephemeral api key', secret)

    await newSession.connect({
      apiKey: secret,
    })

    newSession.sendMessage('Hola. Presentate.')

    console.log('connected to agent successfully')
  }, [session])

  return {
    startAgent,
    session,
  }
}
