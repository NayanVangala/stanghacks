'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [detections, setDetections] = useState<any[]>([])
  const [scanning, setScanning] = useState(false)
  const [radius, setRadius] = useState(0.5)
  const [epicenter, setEpicenter] = useState('')
  const [showPins, setShowPins] = useState(false)
  const [activeTab, setActiveTab] = useState<'map' | 'logs' | 'covered'>('map')
  const [sortBy, setSortBy] = useState<'date' | 'severity' | 'location'>('date')
  const [timeFilter, setTimeFilter] = useState<'week' | '30days' | '6months' | 'year' | 'lifetime'>('lifetime')
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null)
  const mapRef = useRef<any>(null)
  const previousMarkersRef = useRef<any[]>([])

  useEffect(() => {
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
  }, [])

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
    try {
      await fetch('http://127.0.0.1:5000/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ radius, epicenter })
      })
      setTimeout(() => setScanning(false), 12000)
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

  const getTimeFilteredCovered = () => {
    const now = new Date()
    const covered = detections.filter(d => d.status === 'covered')
    if (timeFilter === 'lifetime') return covered
    const ms: any = {
      week: 7 * 24 * 60 * 60 * 1000,
      '30days': 30 * 24 * 60 * 60 * 1000,
      '6months': 180 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    }
    return covered.filter(d => {
      const t = new Date(d.timestamp)
      return now.getTime() - t.getTime() <= ms[timeFilter]
    })
  }

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
        </div>

        <div style={{ height: 1, background: '#2a2a3a' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Scan Settings</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.78rem', color: '#888' }}>Radius (max 1 mi)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a25', border: '1px solid #2a2a3a', borderRadius: 8, padding: '8px 12px' }}>
              <input
                type="number" min={0.1} max={1} step={0.1} value={radius}
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
              <input
                type="text" placeholder="Enter address..." value={epicenter}
                onChange={e => setEpicenter(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#ffd166', width: '100%', fontSize: '0.82rem', outline: 'none' }}
              />
            </div>
          </div>
        </div>

        <button
          onClick={deploy} disabled={scanning}
          style={{ background: scanning ? '#333' : 'linear-gradient(90deg, #ff6b2b, #ffd166)', border: 'none', color: 'white', padding: '12px 0', borderRadius: 10, fontSize: '0.9rem', fontWeight: 700, cursor: scanning ? 'not-allowed' : 'pointer', letterSpacing: 1 }}
        >
          {scanning ? '🚁 Scanning...' : '🚁 DEPLOY SCAN'}
        </button>

        <div style={{ height: 1, background: '#2a2a3a' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.7rem', color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Stats</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Total: <b style={{ color: '#ff6b2b' }}>{detections.length}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Critical: <b style={{ color: '#ff4e4e' }}>{detections.filter(d => d.severity === 'critical' && d.status !== 'covered').length}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Medium: <b style={{ color: '#ff9a3c' }}>{detections.filter(d => d.severity === 'medium' && d.status !== 'covered').length}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Low: <b style={{ color: '#4ade80' }}>{detections.filter(d => d.severity === 'low' && d.status !== 'covered').length}</b></div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Covered: <b style={{ color: '#22d3ee' }}>{detections.filter(d => d.status === 'covered').length}</b></div>
        </div>

        <button
          onClick={togglePins}
          style={{ background: showPins ? '#ff6b2b22' : 'transparent', border: `1px solid ${showPins ? '#ff6b2b' : '#2a2a3a'}`, color: showPins ? '#ff6b2b' : '#888', padding: '8px 0', borderRadius: 8, fontSize: '0.78rem', cursor: 'pointer' }}
        >
          {showPins ? '📍 Hide Previous Pins' : '📍 Show Previous Pins'}
        </button>

        <button
          onClick={startRoute} disabled={detections.filter(d => d.status !== 'covered').length === 0}
          style={{ background: detections.filter(d => d.status !== 'covered').length > 0 ? 'linear-gradient(90deg, #4ade80, #22d3ee)' : '#1a1a25', border: 'none', color: detections.filter(d => d.status !== 'covered').length > 0 ? 'white' : '#444', padding: '10px 0', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
        >
          🗺️ START ROUTE
        </button>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* MAP TAB */}
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

        {/* LOGS TAB */}
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
            {sortedDetections.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#444', marginTop: 60, fontSize: '0.9rem' }}>No active detections</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
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
                        <button
                          onClick={() => window.open(`https://www.google.com/maps?q=${d.lat},${d.lng}`, '_blank')}
                          style={{ flex: 1, background: 'transparent', border: `1px solid #2a2a3a`, color: '#888', padding: '6px 0', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer' }}
                        >
                          View on Maps
                        </button>
                        <button
                          onClick={() => markAsCovered(d.id)}
                          style={{ flex: 1, background: '#22d3ee22', border: `1px solid #22d3ee55`, color: '#22d3ee', padding: '6px 0', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                        >
                          ✅ Mark Covered
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* COVERED TAB */}
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
            {getTimeFilteredCovered().length === 0 ? (
              <div style={{ textAlign: 'center', color: '#444', marginTop: 60, fontSize: '0.9rem' }}>No covered potholes in this time range</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
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
                      <button
                        onClick={() => window.open(`https://www.google.com/maps?q=${d.lat},${d.lng}`, '_blank')}
                        style={{ background: 'transparent', border: `1px solid #2a2a3a`, color: '#888', padding: '6px 0', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer' }}
                      >
                        View on Maps
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}