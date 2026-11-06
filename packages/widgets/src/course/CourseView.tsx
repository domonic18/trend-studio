import { useEffect, useState } from 'react'
import { SectionView } from './SectionView.js'
import type { ChapterView, CoursePreviewHost, CoursePreviewView } from './types.js'

export function CourseView({ view, host }: { view: CoursePreviewView; host: CoursePreviewHost }) {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const handler = () => {
      const sections = document.querySelectorAll('[data-section-id]')
      let current: string | null = null
      for (const el of sections) {
        const rect = el.getBoundingClientRect()
        if (rect.top <= 120) {
          current = el.getAttribute('data-section-id')
        }
      }
      setActiveSection(current)

      const main = document.querySelector('.wg-course-main')
      if (main !== null) {
        const rect = main.getBoundingClientRect()
        const scrollable = rect.height - window.innerHeight
        const done = Math.min(Math.max(-rect.top, 0), Math.max(scrollable, 0))
        setProgress(scrollable > 0 ? done / scrollable : 0)
      }
    }
    window.addEventListener('scroll', handler, { passive: true })
    window.addEventListener('resize', handler)
    handler()
    return () => {
      window.removeEventListener('scroll', handler)
      window.removeEventListener('resize', handler)
    }
  }, [])

  return (
    <div className="wg-course">
      <nav className="wg-course-toc">
        <div className="wg-course-toc-inner">
          <span className="wg-course-toc-title">{view.course.title}</span>
          {view.chapters.map(ch => (
            <ChapterToc key={ch.chapterId} chapter={ch} activeSection={activeSection} />
          ))}
        </div>
        <div className="wg-course-progress" role="presentation">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </nav>
      <main className="wg-course-main">
        {view.chapters.map(ch => (
          <ChapterView key={ch.chapterId} chapter={ch} host={host} />
        ))}
      </main>
    </div>
  )
}

function ChapterToc({ chapter, activeSection }: { chapter: ChapterView; activeSection: string | null }) {
  return (
    <div className="wg-course-toc-chapter">
      <span className="wg-course-toc-chapter-title">{chapter.title}</span>
      {chapter.sections.map(sec => {
        const id = sec.section.sectionId
        const active = activeSection === id
        return (
          <a
            key={id}
            className={`wg-course-toc-section${active ? ' active' : ''}`}
            href={`#${id}`}
            onClick={e => {
              e.preventDefault()
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            {sec.section.title}
          </a>
        )
      })}
    </div>
  )
}

export function ChapterView({ chapter, host }: { chapter: ChapterView; host: CoursePreviewHost }) {
  return (
    <section className="wg-course-chapter">
      <h2 className="wg-course-chapter-title">{chapter.title}</h2>
      {chapter.sections.map(sec => (
        <SectionView key={sec.section.sectionId} section={sec} host={host} />
      ))}
    </section>
  )
}
