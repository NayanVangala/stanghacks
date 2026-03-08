'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'

const PASSWORD = 'stanghacks123'

export default function Home() {
  const [dark, setDark] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [detections, setDetections] = useState<any[]>([])
  const [scanning, setScanning] = useState(false)
  const [radius, setRadius] = useState(0.5)
  const [epicenter, setEpicenter] = useState('')
  const [showPins, setShowPins] = useState(false)
  const [showLiveFeed, setShowLiveFeed] = useState(true)
  const [activeTab, setActiveTab] = useState<'map' | 'logs' | 'covered' | 'analytics'>('map')
  const [sortBy, setSortBy] = useState<'date' | 'severity' | 'location'>('date')
  const [timeFilter, setTimeFilter] = useState<'week' | '30days' | '6months' | 'year' | 'lifetime'>('lifetime')
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const [battery, setBattery] = useState<number | null>(null)

  useEffect(() => {
  setScanCount(parseInt(localStorage.getItem('scanCount') || '0'))
  }, [])

  // Poll battery from tello_patchwork.py local server
  useEffect(() => {
    if (!authed) return
    const poll = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5001/battery')
        const data = await res.json()
        setBattery(data.battery)
      } catch {
        setBattery(null)
      }
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [authed])
  const [lastEpicenter, setLastEpicenter] = useState('')
  const mapRef = useRef<any>(null)
  const tileLayerRef = useRef<any>(null)
  const previousMarkersRef = useRef<any[]>([])
  const scanCircleRef = useRef<any>(null)

  useEffect(() => {
  if (activeTab === 'map' && mapRef.current) {
    setTimeout(() => {
        mapRef.current.invalidateSize()
      }, 400)
    }
  }, [activeTab])

  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => mapRef.current.invalidateSize(), 400)
    }
  }, [showLiveFeed])

  const t = {
    bg:        dark ? '#000000' : '#f5f5f7',
    panel:     dark ? '#0a0a0f' : '#ffffff',
    card:      dark ? '#0d0d14' : '#fafafa',
    input:     dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    border:    dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)',
    borderHov: dark ? 'rgba(255,255,255,0.2)'  : 'rgba(0,0,0,0.25)',
    text:      dark ? '#ffffff' : '#09090b',
    textSub:   dark ? '#a1a1aa' : '#52525b',
    textMuted: dark ? '#52525b' : '#a1a1aa',
    accent:    '#22d3ee',
  }

  const osmTile = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

  // Apply dark filter directly to tile pane so the map div never re-renders
  useEffect(() => {
    if (!mapRef.current) return
    const pane = mapRef.current.getPane('tilePane') as HTMLElement | undefined
    if (pane) {
      pane.style.filter = dark
        ? 'brightness(0.35) saturate(0.4) hue-rotate(180deg)'
        : 'none'
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 50)
  }, [dark])

  const handleLogin = () => {
    if (passwordInput === PASSWORD) { setAuthed(true); setPasswordError(false) }
    else setPasswordError(true)
  }

  useEffect(() => {
    if (!authed) return
    navigator.geolocation.getCurrentPosition((pos) =>
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    )

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => initMap()
    document.head.appendChild(script)

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    supabase.from('detections').select('*').then(({ data }) => { if (data) setDetections(data) })

    const channel = supabase.channel('detections')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'detections' }, (payload: any) => {
        setDetections(prev => [payload.new, ...prev])
        addMarker(payload.new)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'detections' }, (payload: any) => {
        setDetections(prev => prev.map(d => d.id === payload.new.id ? payload.new : d))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [authed])

  const initMap = () => {
    const L = (window as any).L
    if (mapRef.current || !L) return
    mapRef.current = L.map('map').setView([37.7021, -121.9358], 15)
    tileLayerRef.current = L.tileLayer(osmTile).addTo(mapRef.current)
  }

  const addMarker = (d: any) => {
    const L = (window as any).L
    if (!mapRef.current || !L) return
    const color = d.severity === 'critical' ? '#ef4444' : d.severity === 'medium' ? '#f97316' : '#22c55e'
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 10px ${color};"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8]
    })
    L.marker([d.lat, d.lng], { icon })
      .bindPopup(`<b>${d.severity?.toUpperCase()}</b><br>${d.confidence}%<br>${d.timestamp}`)
      .addTo(mapRef.current)
  }

  const markAsCovered = async (id: number) => {
    await supabase.from('detections').update({ status: 'covered' }).eq('id', id)
    setDetections(prev => prev.map(d => d.id === id ? { ...d, status: 'covered' } : d))
  }

  const clearAllData = async () => {
    if (!confirm('clear all detection data?')) return
    await supabase.from('detections').delete().neq('id', 0)
    setDetections([])
    setScanCount(0)
    localStorage.setItem('scanCount', '0')
    setLastEpicenter('')
    if (mapRef.current) mapRef.current.eachLayer((layer: any) => { if (layer._latlng) layer.remove() })
  }

  const togglePins = async () => {
    const L = (window as any).L
    if (showPins) {
      previousMarkersRef.current.forEach((m: any) => m.remove())
      previousMarkersRef.current = []
      setShowPins(false)
    } else {
      const { data } = await supabase.from('detections').select('*')
      if (data && mapRef.current && L) {
        data.forEach((d: any) => {
          const color = d.severity === 'critical' ? '#ef4444' : d.severity === 'medium' ? '#f97316' : '#22c55e'
          const icon = L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;opacity:0.45;"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7]
          })
          previousMarkersRef.current.push(L.marker([d.lat, d.lng], { icon }).addTo(mapRef.current))
        })
      }
      setShowPins(true)
    }
  }

  const startRoute = () => {
    if (detections.length === 0) return
    navigator.geolocation.getCurrentPosition((pos) => {
      const wp = detections.filter(d => d.status !== 'covered').slice(0, 10).map((d: any) => `${d.lat},${d.lng}`).join('/')
      window.open(`https://www.google.com/maps/dir/${pos.coords.latitude},${pos.coords.longitude}/${wp}`, '_blank')
    }, () => {
      const wp = detections.filter(d => d.status !== 'covered').slice(0, 10).map((d: any) => `${d.lat},${d.lng}`).join('/')
      window.open(`https://www.google.com/maps/dir/${wp}`, '_blank')
    })
  }

  const deploy = async () => {
    setScanning(true)
    setScanCount(prev => { const n = prev + 1; localStorage.setItem('scanCount', n.toString()); return n })
    setLastEpicenter(epicenter || 'Dublin, CA')
    const L = (window as any).L
    if (mapRef.current && L) {
      if (scanCircleRef.current) scanCircleRef.current.remove()
      let center = [37.7021, -121.9358]
      if (epicenter) {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(epicenter)}&format=json&limit=1`)
          const data = await res.json()
          if (data[0]) center = [parseFloat(data[0].lat), parseFloat(data[0].lon)]
        } catch {}
      }
      scanCircleRef.current = L.circle(center, {
        radius: radius * 1609.34, color: '#22d3ee', fillColor: '#22d3ee',
        fillOpacity: 0.03, weight: 1, dashArray: '4 8'
      }).addTo(mapRef.current)
      mapRef.current.setView(center, 15)
    }
    try {
      await fetch('http://127.0.0.1:5000/deploy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radius, epicenter })
      })
      setTimeout(() => {
        setScanning(false)
        if (scanCircleRef.current) { scanCircleRef.current.remove(); scanCircleRef.current = null }
      }, 12000)
    } catch { setScanning(false) }
  }

  const getDistance = (d: any) => {
    if (!userLocation) return 0
    const R = 3958.8
    const dLat = (d.lat - userLocation.lat) * Math.PI / 180
    const dLng = (d.lng - userLocation.lng) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(d.lat * Math.PI / 180) * Math.sin(dLng/2)**2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  const active = detections.filter(d => d.status !== 'covered')
  const covered = detections.filter(d => d.status === 'covered')
  const sortedDetections = [...active].sort((a, b) => {
    if (sortBy === 'severity') { const o: any = { critical: 0, medium: 1, low: 2 }; return (o[a.severity]??3)-(o[b.severity]??3) }
    if (sortBy === 'location') return getDistance(a) - getDistance(b)
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  const critical = active.filter(d => d.severity === 'critical').length
  const medium   = active.filter(d => d.severity === 'medium').length
  const low      = active.filter(d => d.severity === 'low').length
  const coveredPct = detections.length > 0 ? Math.round((covered.length / detections.length) * 100) : 0
  const activePct  = detections.length > 0 ? Math.round((active.length  / detections.length) * 100) : 0
  const maxBar = Math.max(critical, medium, low, 1)

  const sevColor = (s: string) => s === 'critical' ? '#ef4444' : s === 'medium' ? '#f97316' : '#22c55e'

  const pageVariants = {
    initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as any } },
    exit:    { opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2 } }
  }

  const navTabs = [
    { id: 'map',       label: 'map',         icon: '⬡' },
    { id: 'logs',      label: 'active logs', icon: '◈' },
    { id: 'covered',   label: 'covered',     icon: '◎' },
    { id: 'analytics', label: 'analytics',   icon: '◰' },
  ]

  const timeFilters = [
    { id: 'week',     label: 'week' },
    { id: '30days',   label: '30 days' },
    { id: '6months',  label: '6 months' },
    { id: 'year',     label: 'year' },
    { id: 'lifetime', label: 'lifetime' },
  ]

  const card = {
    background: t.card,
    borderWidth: '1px', borderStyle: 'solid', borderColor: t.border,
    borderRadius: 18, padding: 22,
    transition: 'background 0.4s ease, border-color 0.4s ease',
  }

  const inputStyle: React.CSSProperties = {
    background: t.input,
    borderWidth: '1px', borderStyle: 'solid', borderColor: t.border,
    borderRadius: 12, padding: '11px 14px',
    color: t.text, fontSize: '0.9rem',
    outline: 'none', width: '100%', boxSizing: 'border-box',
    transition: 'all 0.4s ease',
  }

  const btnGhost: React.CSSProperties = {
    background: 'transparent',
    borderWidth: '1px', borderStyle: 'solid', borderColor: t.border,
    borderRadius: 10, color: t.textSub,
    fontSize: '0.8rem', padding: '8px 0',
    cursor: 'pointer', width: '100%',
    transition: 'all 0.3s ease',
  }

  const filterBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 8,
    fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: active ? t.input : 'transparent',
    borderWidth: '1px', borderStyle: 'solid',
    borderColor: active ? t.borderHov : t.border,
    color: active ? t.text : t.textSub,
  })

  const Logo = ({ size = 26 }: { size?: number }) => (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none">
      <path d="M50 10 L90 50 L50 90 L10 50 Z" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round" fill="none" opacity="0.2"/>
      <path d="M50 28 L72 50 L50 72 L28 50 Z" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round" fill="none" opacity="0.7"/>
      <line x1="50" y1="28" x2="50" y2="72" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      <line x1="28" y1="50" x2="72" y2="50" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
      <circle cx="50" cy="50" r="3.5" fill="#22d3ee"/>
    </svg>
  )

  const ThemeToggle = () => (
    <motion.button
      onClick={() => setDark(!dark)}
      whileTap={{ scale: 0.88 }}
      style={{
        background: t.input, borderWidth: '1px', borderStyle: 'solid', borderColor: t.border,
        borderRadius: 9, padding: '5px 11px', color: t.textSub,
        fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.3s ease',
      }}
    >{dark ? '☀️' : '🌙'}</motion.button>
  )

  // ─── LOGIN ───────────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={{ background: t.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', transition: 'background 0.4s ease' }}
      >
        {/* glow */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1.5 }}
            style={{ width: 700, height: 700, borderRadius: '50%', background: dark ? 'radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)' : 'radial-gradient(circle, rgba(34,211,238,0.14) 0%, transparent 70%)' }}
          />
        </div>

        {/* floating dots */}
        {[
          { top: 120, left: 160 }, { bottom: 160, right: 200 }, { top: 220, right: 140 },
          { bottom: 80, left: 300 }, { top: 60, right: 360 },
        ].map((pos, i) => (
          <motion.div key={i}
            animate={{ y: [0, i % 2 === 0 ? -16 : 16, 0], opacity: [0.12, 0.22, 0.12] }}
            transition={{ duration: 5 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.8 }}
            style={{ position: 'absolute', ...pos, width: i % 3 === 0 ? 8 : 5, height: i % 3 === 0 ? 8 : 5, borderRadius: '50%', background: '#22d3ee' }}
          />
        ))}

        <motion.div
          initial={{ opacity: 0, y: 32, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as any }}
          style={{ width: 400, position: 'relative', zIndex: 10 }}
        >
          <div style={{ background: t.panel, borderWidth: '1px', borderStyle: 'solid', borderColor: t.border, borderRadius: 24, padding: 44, display: 'flex', flexDirection: 'column', gap: 30, transition: 'all 0.4s ease' }}>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <ThemeToggle />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
              <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, delay: 0.2 }} style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', filter: 'blur(20px)', opacity: 0.35, background: 'radial-gradient(circle, #22d3ee, transparent)' }} />
                <Logo size={60} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} style={{ textAlign: 'center' }}>
                <div style={{ color: t.text, fontSize: '1.35rem', fontWeight: 900, letterSpacing: '0.28em', transition: 'color 0.4s ease' }}>patchwork</div>
                <div style={{ color: t.textMuted, fontSize: '0.82rem', marginTop: 8, letterSpacing: '0.05em', transition: 'color 0.4s ease' }}>road intelligence platform</div>
              </motion.div>
            </div>

            <div style={{ height: 1, background: t.border, transition: 'background 0.4s ease' }} />

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="password" placeholder="access code"
                value={passwordInput}
                onChange={e => { setPasswordInput(e.target.value); setPasswordError(false) }}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                style={{ ...inputStyle, borderColor: passwordError ? 'rgba(239,68,68,0.4)' : t.border }}
              />
              <AnimatePresence>
                {passwordError && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{ color: '#ef4444', fontSize: '0.8rem', textAlign: 'center', opacity: 0.8 }}
                  >incorrect access code</motion.p>
                )}
              </AnimatePresence>
              <motion.button
                onClick={handleLogin} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                style={{ background: 'rgba(34,211,238,0.08)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(34,211,238,0.22)', color: '#22d3ee', fontWeight: 700, fontSize: '0.9rem', padding: '13px 0', borderRadius: 14, letterSpacing: '0.15em', cursor: 'pointer', width: '100%', transition: 'all 0.2s ease' }}
              >access dashboard →</motion.button>
            </motion.div>
          </div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
            style={{ color: t.textMuted, fontSize: '0.75rem', textAlign: 'center', marginTop: 18, transition: 'color 0.4s ease' }}
          >authorized personnel only</motion.p>
        </motion.div>
      </motion.main>
    )
  }

  // ─── DASHBOARD ───────────────────────────────────────────────────────────────
  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ background: t.bg, height: '100vh', color: t.text, display: 'flex', overflow: 'hidden', transition: 'background 0.4s ease, color 0.4s ease' }}
    >
      {/* SIDEBAR */}
      <motion.aside
        initial={{ x: -24, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] as any }}
        style={{ width: 240, flexShrink: 0, background: t.panel, borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: t.border, display: 'flex', flexDirection: 'column', gap: 20, padding: 20, overflowY: 'auto', transition: 'all 0.4s ease' }}
      >
        {/* Logo + toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={26} />
          <span style={{ color: t.text, fontWeight: 900, letterSpacing: '0.2em', fontSize: '0.85rem', transition: 'color 0.4s ease' }}>patchwork</span>
          <div style={{ marginLeft: 'auto' }}><ThemeToggle /></div>
        </div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: t.input, borderWidth: '1px', borderStyle: 'solid', borderColor: t.border, borderRadius: 14, transition: 'all 0.4s ease' }}>
          <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0 }}>
            {scanning && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#22d3ee', animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite', opacity: 0.75 }} />}
            <span style={{ position: 'relative', width: 8, height: 8, borderRadius: '50%', background: scanning ? '#22d3ee' : t.textMuted, display: 'inline-block', transition: 'background 0.3s ease' }} />
          </span>
          <span style={{ fontSize: '0.82rem', color: t.textSub, transition: 'color 0.4s ease' }}>{scanning ? 'drone active' : 'standby'}</span>
          {battery !== null && (
            <span style={{ marginLeft: 'auto', fontSize: '0.78rem', fontWeight: 700,
              color: battery <= 20 ? '#ef4444' : battery <= 40 ? '#f97316' : '#22c55e' }}>
              {battery}%
            </span>
          )}
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6, transition: 'color 0.4s ease' }}>navigation</p>
          {navTabs.map(tab => (
            <motion.button key={tab.id} onClick={() => setActiveTab(tab.id as any)} whileTap={{ scale: 0.98 }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 14px', borderRadius: 12, border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.88rem', fontWeight: 500, background: activeTab === tab.id ? t.input : 'transparent', color: activeTab === tab.id ? t.text : t.textSub, transition: 'all 0.2s ease' }}
            >
              <span style={{ color: activeTab === tab.id ? '#22d3ee' : t.textMuted, fontSize: '1rem' }}>{tab.icon}</span>
              {tab.label}
              {tab.id === 'logs' && active.length > 0 &&
                <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700, background: 'rgba(34,211,238,0.1)', color: '#22d3ee', borderRadius: 999, padding: '2px 7px' }}>{active.length}</span>
              }
            </motion.button>
          ))}
        </div>

        <div style={{ height: 1, background: t.border, transition: 'background 0.4s ease' }} />

        {/* Scan settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.15em', transition: 'color 0.4s ease' }}>scan settings</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: '0.75rem', color: t.textSub, transition: 'color 0.4s ease' }}>radius (max 1 mi)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...inputStyle, padding: '10px 14px' }}>
              <input type="number" min={0.1} max={1} step={0.1} value={radius}
                onChange={e => setRadius(Math.min(1, Math.max(0.1, parseFloat(e.target.value))))}
                style={{ background: 'transparent', border: 'none', color: t.text, width: '100%', fontSize: '0.9rem', fontWeight: 600, outline: 'none' }}
              />
              <span style={{ fontSize: '0.78rem', color: t.textMuted }}>mi</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: '0.75rem', color: t.textSub, transition: 'color 0.4s ease' }}>epicenter</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...inputStyle, padding: '10px 14px' }}>
              <span>📍</span>
              <input type="text" placeholder="enter address…" value={epicenter}
                onChange={e => setEpicenter(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: t.text, width: '100%', fontSize: '0.85rem', outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <motion.button onClick={deploy} disabled={scanning} whileTap={{ scale: scanning ? 1 : 0.97 }}
          style={{ width: '100%', padding: '12px 0', borderRadius: 14, fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.12em', cursor: scanning ? 'not-allowed' : 'pointer', transition: 'all 0.3s ease', background: scanning ? t.input : 'rgba(34,211,238,0.08)', borderWidth: '1px', borderStyle: 'solid', borderColor: scanning ? t.border : 'rgba(34,211,238,0.22)', color: scanning ? t.textMuted : '#22d3ee' }}
        >
          {scanning
            ? <motion.span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>⟳</motion.span>
                scanning…
              </motion.span>
            : '🚁 deploy scan'
          }
        </motion.button>

        <div style={{ height: 1, background: t.border, transition: 'background 0.4s ease' }} />

        {/* Stats */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.15em', transition: 'color 0.4s ease' }}>stats</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'total',   value: detections.length, color: t.text },
              { label: 'critical', value: critical,          color: '#ef4444' },
              { label: 'active',   value: active.length,     color: '#f97316' },
              { label: 'covered',  value: covered.length,    color: '#22d3ee' },
            ].map((s, i) => (
              <div key={i} style={{ background: t.input, borderWidth: '1px', borderStyle: 'solid', borderColor: t.border, borderRadius: 14, padding: '12px 14px', transition: 'all 0.4s ease' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: s.color, transition: 'color 0.4s ease' }}>{s.value}</div>
                <div style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 3, transition: 'color 0.4s ease' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
          {[
            { label: showPins ? 'hide pins' : 'show previous pins', onClick: togglePins },
            { label: 'start route', onClick: startRoute, disabled: active.length === 0 },
            { label: 'clear all data', onClick: clearAllData, danger: true },
            { label: 'log out', onClick: () => setAuthed(false) },
          ].map(({ label, onClick, disabled, danger }: any, i) => (
            <motion.button key={i} onClick={onClick} disabled={disabled} whileTap={{ scale: disabled ? 1 : 0.97 }}
              style={{ ...btnGhost, color: danger ? 'rgba(239,68,68,0.55)' : disabled ? t.textMuted : t.textSub, borderColor: danger ? 'rgba(239,68,68,0.12)' : t.border, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
            >{label}</motion.button>
          ))}
        </div>
      </motion.aside>

      {/* MAIN */}
      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* MAP - always mounted so it never loses state */}
        <div style={{ display: activeTab === 'map' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <div id="map" style={{ flex: 1 }} />
          <div style={{ width: showLiveFeed ? 240 : 36, flexShrink: 0, background: t.panel, borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: t.border, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'all 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
            <div style={{ padding: '14px 18px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: t.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              {showLiveFeed && <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.15em', whiteSpace: 'nowrap' }}>live feed</p>}
              <motion.button
                onClick={() => setShowLiveFeed(v => !v)}
                whileTap={{ scale: 0.88 }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2, marginLeft: showLiveFeed ? 'auto' : 0 }}
              >
                <motion.svg
                  width="14" height="14" viewBox="0 0 14 14" fill="none"
                  animate={{ rotate: showLiveFeed ? 180 : 0 }}
                  transition={{ duration: 0.3, ease: [0.22,1,0.36,1] }}
                >
                  <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </motion.svg>
              </motion.button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: showLiveFeed ? 12 : 0, display: showLiveFeed ? 'flex' : 'none', flexDirection: 'column', gap: 8 }}>
              {active.length === 0 && <p style={{ color: t.textMuted, fontSize: '0.82rem', textAlign: 'center', marginTop: 40 }}>no active detections</p>}
              <AnimatePresence>
                {active.map((d, i) => (
                  <motion.div key={d.id ?? i}
                    initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}
                    style={{ background: t.input, borderWidth: '1px', borderStyle: 'solid', borderColor: t.border, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, transition: 'all 0.4s ease' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
                        color: sevColor(d.severity),
                        background: `${sevColor(d.severity)}18`,
                        border: `1px solid ${sevColor(d.severity)}33`,
                        borderRadius: 999, padding: '3px 8px',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sevColor(d.severity), display: 'inline-block', flexShrink: 0 }} />
                        {d.severity}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: t.textMuted }}>{d.timestamp}</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: t.textSub }}>confidence: <span style={{ color: t.text, fontWeight: 600 }}>{d.confidence}%</span></p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">

          {/* LOGS */}
          {activeTab === 'logs' && (
            <motion.div key="logs" variants={pageVariants} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, overflowY: 'auto', padding: 28 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
                <span style={{ fontSize: '0.8rem', color: t.textMuted }}>sort by</span>
                {(['date', 'severity', 'location'] as const).map(s => (
                  <motion.button key={s} onClick={() => setSortBy(s)} whileTap={{ scale: 0.97 }}
                    style={filterBtn(sortBy === s)}
                  >{s === 'date' ? 'date' : s === 'severity' ? 'severity' : 'distance'}</motion.button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: t.textMuted }}>{sortedDetections.length} active</span>
              </div>
              {sortedDetections.length === 0
                ? <p style={{ textAlign: 'center', color: t.textMuted, marginTop: 80, fontSize: '0.9rem' }}>no active detections</p>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                    {sortedDetections.map((d, i) => (
                      <motion.div key={d.id ?? i}
                        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] as any }}
                        style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: sevColor(d.severity) }}>{d.severity}</span>
                          <span style={{ fontSize: '0.72rem', color: t.textMuted }}>{d.timestamp}</span>
                        </div>
                        <p style={{ fontSize: '0.95rem', color: t.text, fontWeight: 600 }}>pothole detected</p>
                        {d.image_url && (
                          <div style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${t.border}` }}>
                            <img src={d.image_url} alt="pothole" style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 140 }} />
                          </div>
                        )}
                        <p style={{ fontSize: '0.82rem', color: t.textSub }}>confidence: <span style={{ color: t.text, fontWeight: 600 }}>{d.confidence}%</span></p>
                        <p style={{ fontSize: '0.75rem', color: t.textMuted }}>📍 {d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}</p>
                        {userLocation && <p style={{ fontSize: '0.75rem', color: t.textMuted }}>🚗 {getDistance(d).toFixed(2)} mi away</p>}
                        <div style={{ height: 1, background: t.border, marginTop: 4 }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <motion.button whileTap={{ scale: 0.97 }} onClick={() => window.open(`https://www.google.com/maps?q=${d.lat},${d.lng}`, '_blank')}
                            style={{ flex: 1, ...btnGhost, padding: '7px 0' }}>maps</motion.button>
                          <motion.button whileTap={{ scale: 0.97 }} onClick={() => markAsCovered(d.id)}
                            style={{ flex: 1, background: 'rgba(34,211,238,0.06)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(34,211,238,0.18)', borderRadius: 10, color: '#22d3ee', fontSize: '0.82rem', fontWeight: 600, padding: '7px 0', cursor: 'pointer', transition: 'all 0.2s ease' }}>covered</motion.button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
              }
            </motion.div>
          )}

          {/* COVERED */}
          {activeTab === 'covered' && (
            <motion.div key="covered" variants={pageVariants} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, overflowY: 'auto', padding: 28 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: t.textMuted }}>filter</span>
                {timeFilters.map(tf => (
                  <motion.button key={tf.id} onClick={() => setTimeFilter(tf.id as any)} whileTap={{ scale: 0.97 }}
                    style={filterBtn(timeFilter === tf.id)}
                  >{tf.label}</motion.button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: t.textMuted }}>{covered.length} covered</span>
              </div>
              {covered.length === 0
                ? <p style={{ textAlign: 'center', color: t.textMuted, marginTop: 80, fontSize: '0.9rem' }}>no covered potholes yet</p>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                    {covered.map((d, i) => (
                      <motion.div key={d.id ?? i}
                        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] as any }}
                        style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#22d3ee' }}>covered</span>
                          <span style={{ fontSize: '0.72rem', color: t.textMuted }}>{d.timestamp}</span>
                        </div>
                        <p style={{ fontSize: '0.95rem', color: t.text, fontWeight: 600 }}>pothole patched</p>
                        <p style={{ fontSize: '0.82rem', color: t.textSub }}>was <span style={{ color: sevColor(d.severity), fontWeight: 600 }}>{d.severity}</span></p>
                        <p style={{ fontSize: '0.75rem', color: t.textMuted }}>📍 {d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}</p>
                        {userLocation && <p style={{ fontSize: '0.75rem', color: t.textMuted }}>🚗 {getDistance(d).toFixed(2)} mi away</p>}
                        <div style={{ height: 1, background: t.border, marginTop: 4 }} />
                        <motion.button whileTap={{ scale: 0.97 }} onClick={() => window.open(`https://www.google.com/maps?q=${d.lat},${d.lng}`, '_blank')}
                          style={{ ...btnGhost, padding: '7px 0' }}>view on maps</motion.button>
                      </motion.div>
                    ))}
                  </div>
              }
            </motion.div>
          )}

          {/* ANALYTICS */}
          {activeTab === 'analytics' && (
            <motion.div key="analytics" variants={pageVariants} initial="initial" animate="animate" exit="exit"
              style={{ flex: 1, overflowY: 'auto', padding: 28 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: t.text, marginRight: 8 }}>analytics</span>
                {timeFilters.map(tf => (
                  <motion.button key={tf.id} onClick={() => setTimeFilter(tf.id as any)} whileTap={{ scale: 0.97 }}
                    style={filterBtn(timeFilter === tf.id)}
                  >{tf.label}</motion.button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
                {[
                  { label: 'total detected', value: detections.length, color: t.text },
                  { label: 'scans run',      value: scanCount,          color: '#22d3ee' },
                  { label: 'covered',        value: covered.length,     color: '#22c55e' },
                  { label: 'active',         value: active.length,      color: '#ef4444' },
                ].map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    style={{ ...card }}
                  >
                    <div style={{ fontSize: '2.4rem', fontWeight: 900, color: s.color, transition: 'color 0.4s ease' }}>{s.value}</div>
                    <div style={{ fontSize: '0.7rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 5, transition: 'color 0.4s ease' }}>{s.label}</div>
                  </motion.div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ ...card }}>
                  <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 20 }}>severity breakdown</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {[
                      { label: 'critical', value: critical, color: '#ef4444' },
                      { label: 'medium',   value: medium,   color: '#f97316' },
                      { label: 'low',      value: low,      color: '#22c55e' },
                    ].map((bar, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 500, color: bar.color }}>{bar.label}</span>
                          <span style={{ fontSize: '0.82rem', color: t.textMuted }}>{bar.value}</span>
                        </div>
                        <div style={{ background: t.input, borderRadius: 999, height: 4, overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }} animate={{ width: `${(bar.value / maxBar) * 100}%` }}
                            transition={{ duration: 0.7, delay: i * 0.1, ease: 'easeOut' }}
                            style={{ height: '100%', borderRadius: 999, background: bar.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ ...card }}>
                  <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 20 }}>coverage rate</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {[
                      { label: 'covered', value: coveredPct, color: '#22d3ee' },
                      { label: 'active',  value: activePct,  color: '#ef4444' },
                    ].map((bar, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 500, color: bar.color }}>{bar.label}</span>
                          <span style={{ fontSize: '0.82rem', color: t.textMuted }}>{bar.value}%</span>
                        </div>
                        <div style={{ background: t.input, borderRadius: 999, height: 4, overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }} animate={{ width: `${bar.value}%` }}
                            transition={{ duration: 0.7, delay: i * 0.1, ease: 'easeOut' }}
                            style={{ height: '100%', borderRadius: 999, background: bar.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 18, padding: '12px 14px', background: t.input, borderRadius: 12, fontSize: '0.82rem', color: t.textSub, transition: 'all 0.4s ease' }}>
                    {detections.length === 0 ? 'no data yet — deploy a scan first.' : `${coveredPct}% of detected potholes have been patched.`}
                  </div>
                </div>

                <div style={{ ...card, gridColumn: 'span 2' }}>
                  <p style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 18 }}>last scan</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
                    {[
                      { label: 'location',    value: lastEpicenter || '—' },
                      { label: 'radius',      value: `${radius} mi` },
                      { label: 'total scans', value: String(scanCount) },
                    ].map((s, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ fontSize: '0.68rem', color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', transition: 'color 0.4s ease' }}>{s.label}</span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: t.text, transition: 'color 0.4s ease' }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </motion.main>
  )
}