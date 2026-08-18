import { useState } from 'react'
import { Legend } from './Legend'
import { ArrangeTab } from './ArrangeTab'
import { StoreTab } from './StoreTab'
import type { Doc } from '../domain/types'

type TabId = 'arrange' | 'store' | 'legend'

interface Props {
  doc: Doc
  /** Current OPFS slug for save/export. */
  slug: string
}

/** Right-side pane for the tracker view with Arrange, Store, and Legend tabs. */
export function TrackerRightPane({ doc, slug }: Props) {
  const [tab, setTab] = useState<TabId>('arrange')

  return (
    <aside className="tracker-pane">
      <div className="tracker-pane-tabs">
        {(['arrange', 'store', 'legend'] as TabId[]).map((t) => (
          <button
            key={t}
            className={'tracker-pane-tab' + (tab === t ? ' active' : '')}
            onClick={() => setTab(t)}
          >
            {t === 'arrange' ? 'Arrange' : t === 'store' ? 'Store' : 'Legend'}
          </button>
        ))}
      </div>
      <div className="tracker-pane-body">
        {tab === 'arrange' && <ArrangeTab doc={doc} />}
        {tab === 'store' && <StoreTab slug={slug} />}
        {tab === 'legend' && <Legend />}
      </div>
    </aside>
  )
}
