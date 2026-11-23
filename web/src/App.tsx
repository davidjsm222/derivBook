import { useEffect, useState } from 'react'
import { engine } from './engine/client.ts'
import Explorer from './explorer/Explorer.tsx'
import Book from './book/Book.tsx'
import Exposure from './exposure/Exposure.tsx'

type Route = 'explorer' | 'book' | 'exposure'

// #/book is the Book, #/exposure the Exposure tab; #/map (the v5 exposure map's address) lands there too
function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h === 'book') return 'book'
  if (h === 'exposure' || h === 'map') return 'exposure'
  return 'explorer'
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 19 H10 Q15 19 21 5" style={{ fill: 'none', stroke: 'var(--hi)', strokeWidth: 2, strokeLinecap: 'round' }} />
      <circle cx="10" cy="19" r="2.4" style={{ fill: 'var(--acc)' }} />
    </svg>
  )
}

function Grain() {
  return (
    <svg className="grain" aria-hidden="true">
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={3} stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.title = route === 'book' ? 'derivBook Book' : route === 'exposure' ? 'derivBook Exposure' : 'derivBook Explorer'
    // The Explorer needs Python as soon as it opens; Book and Exposure start it with their first request
    if (route === 'explorer') engine.start()
  }, [route])

  return (
    <div className="page">
      <Grain />
      <header className="shell site-header">
        <div className="header-bar">
          <a className="brand" href="#/">
            <Logo />
            <span>derivBook</span>
          </a>
          <nav className="views" aria-label="Views">
            <a href="#/" aria-current={route === 'explorer' ? 'page' : undefined} onPointerEnter={engine.start} onFocus={engine.start}>
              Explorer
            </a>
            <a href="#/book" aria-current={route === 'book' ? 'page' : undefined}>
              Book
            </a>
            <a href="#/exposure" aria-current={route === 'exposure' ? 'page' : undefined}>
              Exposure
            </a>
            <span className="soon" aria-disabled="true">
              Market making <span className="badge">Soon</span>
            </span>
          </nav>
        </div>
      </header>
      {route === 'book' ? <Book /> : route === 'exposure' ? <Exposure /> : <Explorer />}
    </div>
  )
}
