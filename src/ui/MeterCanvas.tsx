import { useEffect, useRef } from 'react'
import type { AudioHost } from '../audio/host'
import { CLIP_THRESHOLD } from './scope'

export function MeterCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const levelRef = useRef(0)

  useEffect(() => {
    // The useEngine hook wires `globalThis.__host` in dev mode; poll that.
    const getHost = (): AudioHost | null => {
      const g = globalThis as Record<string, unknown>
      return (g.__host as AudioHost | undefined) ?? null
    }

    let frame = 0
    const draw = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const host = getHost()
      const level = host ? host.getLevel() : 0
      levelRef.current = level

      const w = canvas.width
      const h = canvas.height
      const barW = (w - 6) / 2
      const clipR = h * 0.12

      ctx.clearRect(0, 0, w, h)

      // Left and right bars (approximate stereo from mono level)
      const l = level
      const r = level * 0.95

      const drawBar = (val: number, x: number, label: string) => {
        const barH = Math.max(0, (h - clipR - 4) * val)
        const barY = h - barH - 2

        // Background
        ctx.fillStyle = '#111'
        ctx.fillRect(x, clipR, barW, h - clipR - 2)

        // Level
        const grad = ctx.createLinearGradient(x, h, x, clipR)
        grad.addColorStop(0, '#4c4')
        grad.addColorStop(0.4, '#cc4')
        grad.addColorStop(0.6, '#ea4')
        grad.addColorStop(0.8, '#e44')
        ctx.fillStyle = grad
        ctx.fillRect(x, barY, barW, barH)

        // Label
        ctx.fillStyle = '#666'
        ctx.font = '7px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(label, x + barW / 2, h - 1)

        // Clip dot
        ctx.beginPath()
        ctx.arc(x + barW / 2, clipR / 2, 3, 0, Math.PI * 2)
        ctx.fillStyle = val > CLIP_THRESHOLD ? '#f00' : '#300'
        ctx.fill()
        if (val > CLIP_THRESHOLD) {
          ctx.shadowColor = '#f00'
          ctx.shadowBlur = 4
          ctx.fill()
          ctx.shadowBlur = 0
        }
      }

      drawBar(l, 2, 'L')
      drawBar(r, 4 + barW, 'R')

      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [width, height])

  return <canvas ref={canvasRef} width={width} height={height} style={{ display: 'block', borderRadius: 2, background: '#0a0c10', marginTop: 2 }} />
}
