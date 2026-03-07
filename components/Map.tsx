'use client'

import { useEffect, useRef } from 'react'

export default function Map({ detections }: { detections: any[] }) {  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const L = require('leaflet')
    require('leaflet/dist/leaflet.css')

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([37.7021, -121.9358], 15)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInstanceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!mapInstanceRef.current || typeof window === 'undefined') return
    const L = require('leaflet')

    if (detections.length > 0) {
      const latest = detections[0]
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:20px;height:20px;border-radius:50%;background:#ff6b2b;border:3px solid white;box-shadow:0 0 10px #ff6b2b;"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
      L.marker([latest.lat, latest.lng], { icon })
        .bindPopup(`<b>Pothole</b><br>Confidence: ${latest.confidence}%`)
        .addTo(mapInstanceRef.current)
    }
  }, [detections])

  return <div ref={mapRef} style={{ flex: 1, height: '100%' }} />
}