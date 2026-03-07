'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const PASSWORD = 'stanghacks123'

export default function Home() {
  const [authed, setAuthed] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [detections, setDetections] = useState<any[]>([])
  const [scanning, setScanning] = useState(false)
  const [radius, setRadius] = useState(0.5)
  const [epicenter, setEpicenter] = useState('')
  const [showPins, setShowPins] = useState(false)
  const [activeTab, setActiveTab] = useState<'map' | 'logs' | 'covered' | 'analytics'>('map')
  const [sortBy, setSortBy] = useState<'date' | 'severity' | 'location'>('date')
  const [timeFilter, setTimeFilter] = useState<'week' | '30days' | '6months' | 'year' | 'lifetime'>('lifetime')
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const [lastEpicenter, setLastEpicenter] = useState('')
  const mapRef = useRef<any>(null)
  const previousMarkersRef = useRef<any[]>([])
  const scanCircleRef = useRef<any>(null)

  const handleLogin = () => {
    if (passwordInput === PASSWORD) {
      setAuthed(true)
      setPasswordError(false)
    } else {
      setPasswordError(true)
    }
  }

  useEffect(() => {
    if (!authed) return
    navigator.geolocation.getCurrentPosition((pos) => {
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    })

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => initMap()
    document.head.appendChild(script)

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)

    const fetchDetections = async () => {
      const { data } = await supabase.from('detections').select('*')
      if (data) setDetections(data)
    }
    fetchDetections()

    const channel = supabase
      .channel('detections')
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapRef.current)
  }

  const addMarker = (d: any) => {
    const L = (window as any).L
    if (!mapRef.current || !L) return
    const color = d.severity === 'critical' ? '#ff4e4e' : d.severity === 'medium' ? '#ff9a3c' : '#4ade80'
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 10px ${color};"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    })
    L.marker([d.lat, d.lng], { icon })
      .bindPopup(`<b>${d.severity?.toUpperCase() || 'POTHOLE'}</b><br>Confidence: ${d.confidence}%<br>Time: ${d.timestamp}`)
      .addTo(mapRef.current)
  }

  const markAsCovered = async (id: number) => {
    await supabase.from('detections').update({ status: 'covered' }).eq('id', id)
    setDetections(prev => prev.map(d => d.id === id ? { ...d, status: 'covered' } : d))
  }

  const clearAllData = async () => {
    if (!confirm('Are you sure you want to clear all detection data? This cannot be undone.')) return
    await supabase.from('detections').delete().neq('id', 0)
    setDetections([])
    setScanCount(0)
    setLastEpicenter('')
    if (mapRef.current) {
      mapRef.current.eachLayer((layer: any) => {
        if (layer._latlng) layer.remove()
      })
    }
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
          const color = d.severity === 'critical' ? '#ff4e4e' : d.severity === 'medium' ? '#ff9a3c' : '#4ade80'
          const icon = L.divIcon({
            className: '',
            html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 10px ${color};opacity:0.6"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          })
          const marker = L.marker([d.lat, d.lng], { icon })
            .bindPopup(`<b>${d.severity?.toUpperCase() || 'POTHOLE'}</b><br>Confidence: ${d.confidence}%<br>Time: ${d.timestamp}`)
            .addTo(mapRef.current)
          previousMarkersRef.current.push(marker)
        })
      }
      setShowPins(true)
    }
  }

  const startRoute = () => {
    if (detections.length === 0) return
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords
      const base = 'https://www.google.com/maps/dir/'
      const start = `${latitude},${longitude}/`
      const waypoints = detections.filter(d => d.status !== 'covered').slice(0, 10).map((d: any) => `${d.lat},${d.lng}`).join('/')
      window.open(base + start + waypoints, '_blank')
    }, () => {
      const base = 'https://www.google.com/maps/dir/'
      const waypoints = detections.filter(d => d.status !== 'covered').slice(0, 10).map((d: any) => `${d.lat},${d.lng}`).join('/')
      window.open(base + waypoints, '_blank')
    })
  }

  const deploy = async () => {
    setScanning(true)
    setScanCount(prev => prev + 1)
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
      const radiusMeters = radius * 1609.34
      scanCircleRef.current = L.circle(center, {
        radius: radiusMeters,
        color: '#ffd166',
        fillColor: '#ffd166',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '6 6'
      }).addTo(mapRef.current)
      mapRef.current.setView(center, 15)
    }
    try {
      await fetch('http://127.0.0.1:5000/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radius, epicenter })
      })
      setTimeout(() => {
        setScanning(false)
        if (scanCircleRef.current) { scanCircleRef.current.remove(); scanCircleRef.current = null }
      }, 12000)
    } catch (e) {
      console.error('Deploy failed:', e)
      setScanning(false)
    }
  }

  const getDistance = (d: any) => {
    if (!userLocation) return 0
    const R = 3958.8
    const dLat = (d.lat - userLocation.lat) * Math.PI / 180
    const dLng = (d.lng - userLocation.lng) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(userLocation.lat * Math.PI / 180) * Math.cos(d.lat * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  }

  const getTimeFilteredCovered = () => detections.filter(d => d.status === 'covered')

  const sortedDetections = [...detections.filter(d => d.status !== 'covered')].sort((a, b) => {
    if (sortBy === 'severity') {
      const order: any = { critical: 0, medium: 1, low: 2 }
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
    }
    if (sortBy === 'location') return getDistance(a) - getDistance(b)
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  const tabStyle = (tab: string) => ({
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    width: '100%',
    textAlign: 'left' as const,
    background: activeTab === tab ? 'linear-gradient(90deg, #ff6b2b, #ffd166)' : 'transparent',
    color: activeTab === tab ? 'white' : '#888',
  })

  const timeFilterStyle = (t: string) => ({
    padding: '6px 14px',
    borderRadius: 8,
    border: `1px solid ${timeFilter === t ? '#22d3ee' : '#2a2a3a'}`,
    background: timeFilter === t ? '#22d3ee22' : 'transparent',
    color: timeFilter === t ? '#22d3ee' : '#888',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
  })

  // Analytics helpers
  const TIME_MS: Record<string, number> = {
  week: 7*86400000, '30days': 30*86400000, '6months': 180*86400000, year: 365*86400000,
}
  const analyticsDetections = detections
  const total = analyticsDetections.length
  const critical = analyticsDetections.filter(d => d.severity === 'critical' && d.status !== 'covered').length
  const medium = analyticsDetections.filter(d => d.severity === 'medium' && d.status !== 'covered').length
  const low = analyticsDetections.filter(d => d.severity === 'low' && d.status !== 'covered').length
  const coveredCount = analyticsDetections.filter(d => d.status === 'covered').length
  const activeCount = analyticsDetections.filter(d => d.status !== 'covered').length
  const coveredPct = total > 0 ? Math.round((coveredCount / total) * 100) : 0
  const activePct = total > 0 ? Math.round((activeCount / total) * 100) : 0
  const maxBar = Math.max(critical, medium, low, 1)

  if (!authed) {
    return (
      <main style={{ background: '#080810', height: '100vh', color: 'white', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 20, padding: 48, width: 360, display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>
          <div style={{ fontSize: '2rem' }}>🛣️</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: 3, background: 'linear-gradient(90deg, #ff6b2b, #ffd166)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>
              PATCHWORK
            </div>
            <div style={{ fontSize: '0.82rem', color: '#555', lineHeight: 1.5 }}>
              Authorized personnel only.<br />Enter your access code to continue.
            </div>
          </div>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="password"
              placeholder="Enter access code..."
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setPasswordError(false) }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              style={{ background: '#1a1a25', border: `1px solid ${passwordError ? '#ff4e4e' : '#2a2a3a'}`, borderRadius: 10, padding: '12px 16px', color: 'white', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' }}
            />
            {passwordError && <div style={{ fontSize: '0.78rem', color: '#ff4e4e', textAlign: 'center' }}>❌ Incorrect access code</div>}
            <button onClick={handleLogin}
              style={{ background: 'linear-gradient(90deg, #ff6b2b, #ffd166)', border: 'none', color: 'white', padding: '12px 0', borderRadius: 10, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', letterSpacing: 1, width: '100%' }}
            >ACCESS DASHBOARD</button>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#333', textAlign: 'center' }}>Patchwork · Road Intelligence Platform</div>
        </div>
      </main>
    )
  }

  return (
    <main style={{ background: '#080810', height: '100vh', color: 'white', fontFamily: 'sans-serif', display: 'flex' }}>

      {/* LEFT SIDEBAR */}
      <div style={{ width: 260, background: '#13131a', borderRight: '1px solid #2a2a3a', display: 'flex', flexDirection: 'column', padding: 20, gap: 24, flexShrink: 0, overflowY: 'auto' }}>

        <div style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: 2, background: 'linear-gradient(90deg, #ff6b2b, #ffd166)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🛣️ PATCHWORK
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: scanning ? '#4ade80' : '#555', boxShadow: scanning ? '0 0 8px #4ade80' : 'none' }}/>
          <span style={{ fontSize: '0.82rem', color: '#888' }}>{scanning ? 'Drone Active' : 'Standby'}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>Navigation</div>
          <button style={tabStyle('map')} onClick={() => setActiveTab('map')}>🗺️ Map</button>
          <button style={tabStyle('logs')} onClick={() => setActiveTab('logs')}>📋 Active Logs</button>
          <button style={tabStyle('covered')} onClick={() => setActiveTab('covered')}>✅ Covered</button>
          <button style={tabStyle('analytics')} onClick={() => setActiveTab('analytics')}>📊 Analytics</button>
        </div>

        <div style={{ height: 1, background: '#2a2a3a' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Scan Settings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.78rem', color: '#888' }}>Radius (max 1 mi)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 8, padding: '8px 12px' }}>
              <input type="number" min={0.1} max={1} step={0.1} value={radius}
                onChange={e => setRadius(Math.min(1, Math.max(0.1, parseFloat(e.target.value))))}
                style={{ background: 'transparent', border: 'none', color: '#ffd166', width: '100%', fontSize: '0.9rem', fontWeight: 700, outline: 'none' }}
              />
              <span style={{ fontSize: '0.8rem', color: '#888' }}>mi</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.78rem', color: '#888' }}>Epicenter</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ fontSize: '0.8rem', color: '#888' }}>📍</span>
              <input type="text" placeholder="Enter address..." value={epicenter}
                onChange={e => setEpicenter(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#ffd166', width: '100%', fontSize: '0.82rem', outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <button onClick={deploy} disabled={scanning}
          style={{ background: scanning ? '#333' : 'linear-gradient(90deg, #ff6b2b, #ffd166)', border: 'none', color: 'white', padding: '12px 0', borderRadius: 10, fontSize: '0.9rem', fontWeight: 700, cursor: scanning ? 'not-allowed' : 'pointer', letterSpacing: 1 }}
        >
          {scanning ? '🚁 Scanning...' : '🚁 DEPLOY SCAN'}
        </button>

        <div style={{ height: 1, background: '#2a2a3a' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Stats</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Total: <b style={{ color: '#ff6b2b' }}>{detections.length}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Critical: <b style={{ color: '#ff4e4e' }}>{critical}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Medium: <b style={{ color: '#ff9a3c' }}>{medium}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Low: <b style={{ color: '#4ade80' }}>{low}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Covered: <b style={{ color: '#22d3ee' }}>{coveredCount}</b></div>
        </div>

        <button onClick={togglePins}
          style={{ background: showPins ? '#ff6b2b22' : 'transparent', border: `1px solid ${showPins ? '#ff6b2b' : '#2a2a3a'}`, color: showPins ? '#ff6b2b' : '#888', padding: '8px 0', borderRadius: 8, fontSize: '0.78rem', cursor: 'pointer' }}
        >
          {showPins ? '📍 Hide Previous Pins' : '📍 Show Previous Pins'}
        </button>

        <button onClick={startRoute} disabled={detections.filter(d => d.status !== 'covered').length === 0}
          style={{ background: detections.filter(d => d.status !== 'covered').length > 0 ? 'linear-gradient(90deg, #4ade80, #22d3ee)' : '#1a1a25', border: 'none', color: detections.filter(d => d.status !== 'covered').length > 0 ? 'white' : '#444', padding: '10px 0', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
        >
          🗺️ START ROUTE
        </button>

        <button onClick={clearAllData}
          style={{ background: 'transparent', border: '1px solid #ff4e4e44', color: '#ff4e4e88', padding: '8px 0', borderRadius: 8, fontSize: '0.75rem', cursor: 'pointer' }}
        >
          🗑️ Clear All Data
        </button>

        <button onClick={() => setAuthed(false)}
          style={{ background: 'transparent', border: '1px solid #2a2a3a', color: '#555', padding: '8px 0', borderRadius: 8, fontSize: '0.75rem', cursor: 'pointer' }}
        >
          🔒 Log Out
        </button>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {activeTab === 'map' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div id="map" style={{ flex: 1 }} />
            <div style={{ width: 260, background: '#13131a', borderLeft: '1px solid #2a2a3a', overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: '0.85rem', color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', padding: '8px 4px' }}>⚠️ Live Feed</div>
              {detections.filter(d => d.status !== 'covered').length === 0 && <div style={{ color: '#444', fontSize: '0.82rem', textAlign: 'center', marginTop: 20 }}>No active detections</div>}
              {detections.filter(d => d.status !== 'covered').map((d, i) => {
                const color = d.severity === 'critical' ? '#ff4e4e' : d.severity === 'medium' ? '#ff9a3c' : '#4ade80'
                return (
                  <div key={i} style={{ background: '#1a1a25', border: `1px solid ${color}33`, borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: `${color}22`, color, textTransform: 'uppercase' }}>{d.severity || 'POTHOLE'}</span>
                      <span style={{ fontSize: '0.72rem', color: '#555' }}>{d.timestamp}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#888' }}>Confidence: <b style={{ color: '#ffd166' }}>{d.confidence}%</b></div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: '0.85rem', color: '#888' }}>Sort by:</span>
              {(['date', 'severity', 'location'] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)}
                  style={{ background: sortBy === s ? '#ff6b2b22' : 'transparent', border: `1px solid ${sortBy === s ? '#ff6b2b' : '#2a2a3a'}`, color: sortBy === s ? '#ff6b2b' : '#888', padding: '6px 14px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  {s === 'date' ? '📅 Date' : s === 'severity' ? '⚠️ Severity' : '📍 Location'}
                </button>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: '#555' }}>{sortedDetections.length} active</span>
            </div>
            {sortedDetections.length === 0
              ? <div style={{ textAlign: 'center', color: '#444', marginTop: 60, fontSize: '0.9rem' }}>No active detections</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  {sortedDetections.map((d, i) => {
                    const color = d.severity === 'critical' ? '#ff4e4e' : d.severity === 'medium' ? '#ff9a3c' : '#4ade80'
                    const dist = getDistance(d)
                    return (
                      <div key={i} style={{ background: '#13131a', border: `1px solid ${color}33`, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: `${color}22`, color, textTransform: 'uppercase' }}>{d.severity || 'unknown'}</span>
                          <span style={{ fontSize: '0.7rem', color: '#555' }}>{d.timestamp}</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#ccc', fontWeight: 600 }}>Pothole Detected</div>
                        <div style={{ fontSize: '0.78rem', color: '#888' }}>Confidence: <b style={{ color: '#ffd166' }}>{d.confidence}%</b></div>
                        <div style={{ fontSize: '0.75rem', color: '#555' }}>📍 {d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}</div>
                        {userLocation && <div style={{ fontSize: '0.75rem', color: '#666' }}>🚗 {dist.toFixed(2)} miles away</div>}
                        <div style={{ height: 1, background: `${color}22`, marginTop: 4 }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => window.open(`https://www.google.com/maps?q=${d.lat},${d.lng}`, '_blank')}
                            style={{ flex: 1, background: 'transparent', border: `1px solid #2a2a3a`, color: '#888', padding: '6px 0', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer' }}
                          >View on Maps</button>
                          <button onClick={() => markAsCovered(d.id)}
                            style={{ flex: 1, background: '#22d3ee22', border: `1px solid #22d3ee55`, color: '#22d3ee', padding: '6px 0', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                          >✅ Mark Covered</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
            }
          </div>
        )}

        {activeTab === 'covered' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: '#888' }}>Time filter:</span>
              {(['week', '30days', '6months', 'year', 'lifetime'] as const).map(t => (
                <button key={t} onClick={() => setTimeFilter(t)} style={timeFilterStyle(t)}>
                  {t === 'week' ? 'Past Week' : t === '30days' ? 'Past 30 Days' : t === '6months' ? 'Past 6 Months' : t === 'year' ? 'Past Year' : 'Lifetime'}
                </button>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: '#555' }}>{getTimeFilteredCovered().length} covered</span>
            </div>
            {getTimeFilteredCovered().length === 0
              ? <div style={{ textAlign: 'center', color: '#444', marginTop: 60, fontSize: '0.9rem' }}>No covered potholes in this time range</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  {getTimeFilteredCovered().map((d, i) => {
                    const dist = getDistance(d)
                    return (
                      <div key={i} style={{ background: '#13131a', border: `1px solid #22d3ee33`, borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: '#22d3ee22', color: '#22d3ee' }}>✅ COVERED</span>
                          <span style={{ fontSize: '0.7rem', color: '#555' }}>{d.timestamp}</span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#ccc', fontWeight: 600 }}>Pothole Patched</div>
                        <div style={{ fontSize: '0.78rem', color: '#888' }}>Was <b style={{ color: d.severity === 'critical' ? '#ff4e4e' : d.severity === 'medium' ? '#ff9a3c' : '#4ade80' }}>{d.severity}</b> severity</div>
                        <div style={{ fontSize: '0.75rem', color: '#555' }}>📍 {d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}</div>
                        {userLocation && <div style={{ fontSize: '0.75rem', color: '#666' }}>🚗 {dist.toFixed(2)} miles away</div>}
                        <div style={{ height: 1, background: '#22d3ee22', marginTop: 4 }} />
                        <button onClick={() => window.open(`https://www.google.com/maps?q=${d.lat},${d.lng}`, '_blank')}
                          style={{ background: 'transparent', border: `1px solid #2a2a3a`, color: '#888', padding: '6px 0', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer' }}
                        >View on Maps</button>
                      </div>
                    )
                  })}
                </div>
            }
          </div>
        )}

        {activeTab === 'analytics' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#aaa', letterSpacing: 1 }}>📊 Analytics Overview</div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  {(['week', '30days', '6months', 'year', 'lifetime'] as const).map(t => (
                    <button key={t} onClick={() => setTimeFilter(t)} style={timeFilterStyle(t)}>
                      {t === 'week' ? 'Week' : t === '30days' ? '30 Days' : t === '6months' ? '6 Mo' : t === 'year' ? 'Year' : 'Lifetime'}
                    </button>
                  ))}
                </div>
              </div>

            {/* STAT CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
              {[
                { label: 'Total Detected', value: total, color: '#ff6b2b' },
                { label: 'Total Scans Run', value: scanCount, color: '#ffd166' },
                { label: 'Covered', value: coveredCount, color: '#22d3ee' },
                { label: 'Active', value: activeCount, color: '#ff4e4e' },
              ].map((s, i) => (
                <div key={i} style={{ background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: '2rem', fontWeight: 900, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '0.75rem', color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

              {/* BAR CHART */}
              <div style={{ background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 16, padding: 24 }}>
                <div style={{ fontSize: '0.82rem', color: '#888', marginBottom: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Severity Breakdown</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {[
                    { label: 'Critical', value: critical, color: '#ff4e4e' },
                    { label: 'Medium', value: medium, color: '#ff9a3c' },
                    { label: 'Low', value: low, color: '#4ade80' },
                  ].map((bar, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.78rem', color: bar.color, fontWeight: 600 }}>{bar.label}</span>
                        <span style={{ fontSize: '0.78rem', color: '#555' }}>{bar.value}</span>
                      </div>
                      <div style={{ background: '#1a1a25', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 999, background: bar.color, width: `${(bar.value / maxBar) * 100}%`, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* COVERAGE DONUT STYLE */}
              <div style={{ background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 16, padding: 24 }}>
                <div style={{ fontSize: '0.82rem', color: '#888', marginBottom: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Coverage Rate</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {[
                    { label: 'Covered', value: coveredPct, color: '#22d3ee' },
                    { label: 'Active', value: activePct, color: '#ff4e4e' },
                  ].map((bar, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.78rem', color: bar.color, fontWeight: 600 }}>{bar.label}</span>
                        <span style={{ fontSize: '0.78rem', color: '#555' }}>{bar.value}%</span>
                      </div>
                      <div style={{ background: '#1a1a25', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 999, background: bar.color, width: `${bar.value}%`, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 20, padding: 16, background: '#1a1a25', borderRadius: 12, fontSize: '0.82rem', color: '#888' }}>
                  {total === 0 ? 'No data yet — deploy a scan first.' : `${coveredPct}% of all detected potholes have been patched.`}
                </div>
              </div>

              {/* LAST SCAN */}
              <div style={{ background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 16, padding: 24, gridColumn: 'span 2' }}>
                <div style={{ fontSize: '0.82rem', color: '#888', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Last Scan Info</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.72rem', color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Location</span>
                    <span style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 600 }}>{lastEpicenter || '—'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.72rem', color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Radius</span>
                    <span style={{ fontSize: '0.9rem', color: '#ffd166', fontWeight: 600 }}>{radius} mi</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: '0.72rem', color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>Total Scans</span>
                    <span style={{ fontSize: '0.9rem', color: '#ff6b2b', fontWeight: 600 }}>{scanCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}