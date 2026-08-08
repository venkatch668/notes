import type { RibbonTab } from '../types/ui';

/* ------------------------------------------------------------- Title bar */

export function TitleBar({
  notebookName,
  aiOpen,
  insightsOpen,
  navOpen,
  onToggleNav,
  onSearch,
  onToggleAi,
  onToggleInsights,
}: {
  notebookName: string;
  aiOpen: boolean;
  insightsOpen: boolean;
  navOpen: boolean;
  onToggleNav: () => void;
  onSearch: () => void;
  onToggleAi: () => void;
  onToggleInsights: () => void;
}) {
  return (
    <header className="titlebar">
      <button
        type="button"
        className="titlebar__nav"
        onClick={onToggleNav}
        aria-expanded={navOpen}
        aria-label={navOpen ? 'Hide navigation' : 'Show navigation'}
        title="Show navigation"
      >
        ☰
      </button>

      <div className="titlebar__brand">
        <span className="titlebar__logo" aria-hidden>
          N
        </span>
        <span className="titlebar__name">{notebookName}</span>
      </div>

      <div className="titlebar__search">
        <button type="button" className="titlebar__searchbox" onClick={onSearch} aria-label="Search">
          <span aria-hidden>🔍</span>
          <span className="titlebar__searchlabel">Search all notebooks</span>
          <span className="titlebar__kbd">Ctrl K</span>
        </button>
      </div>

      <div className="titlebar__actions">
        <button
          type="button"
          className={`titlebar__btn titlebar__btn--wide ${insightsOpen ? 'titlebar__btn--on' : ''}`}
          onClick={onToggleInsights}
        >
          Insights
        </button>
        <button
          type="button"
          className={`titlebar__btn ${aiOpen ? 'titlebar__btn--on' : ''}`}
          onClick={onToggleAi}
          title="Toggle AI assistant (Ctrl+J)"
        >
          <span aria-hidden>✨</span>
          <span className="titlebar__btnlabel"> Assistant</span>
        </button>
        <span className="titlebar__avatar" aria-hidden>
          V
        </span>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------- Tab strip */

const TABS: RibbonTab[] = ['File', 'Home', 'Insert', 'Draw', 'View', 'Help'];

export function TabStrip({
  active,
  onSelect,
}: {
  active: RibbonTab;
  onSelect: (t: RibbonTab) => void;
}) {
  return (
    <nav className="tabstrip" aria-label="Ribbon tabs">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          className={`tabstrip__tab ${t === active ? 'tabstrip__tab--active' : ''}`}
          onClick={() => onSelect(t)}
          aria-current={t === active}
        >
          {t}
        </button>
      ))}
    </nav>
  );
}

/* --------------------------------------------------------------- Toolbar */

export interface RibbonActions {
  setBlockType: (type: 'TEXT' | 'HEADING' | 'BULLET' | 'NUMBER' | 'CHECKBOX' | 'CODE' | 'DIVIDER', level?: 1 | 2 | 3) => void;
  wrapInline: (marker: string) => void;
  addTag: (tag: string) => void;
  insertTemplate: () => void;
  newPage: () => void;
  today: () => void;
  exportJson: () => void;
}

function Tool({
  glyph,
  label,
  tall,
  onClick,
  title,
}: {
  glyph: string;
  label?: string;
  tall?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`tool ${tall ? 'tool--tall' : ''}`}
      onClick={onClick}
      title={title ?? label ?? glyph}
    >
      <span className="tool__glyph" aria-hidden>
        {glyph}
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="toolgroup">
      <div className="toolgroup__row">{children}</div>
      <div className="toolgroup__label">{label}</div>
    </div>
  );
}

export function Toolbar({ tab, actions }: { tab: RibbonTab; actions: RibbonActions }) {
  if (tab === 'Insert') {
    return (
      <div className="toolbar">
        <Group label="Pages">
          <Tool glyph="▤" label="New page" tall onClick={actions.newPage} />
          <Tool glyph="▦" label="Day template" tall onClick={actions.insertTemplate} />
        </Group>
        <Group label="Blocks">
          <Tool glyph="☑" label="To Do" tall onClick={() => actions.setBlockType('CHECKBOX')} />
          <Tool glyph="{;}" label="Code" tall onClick={() => actions.setBlockType('CODE')} />
          <Tool glyph="―" label="Divider" tall onClick={() => actions.setBlockType('DIVIDER')} />
        </Group>
        <Group label="Tags">
          <Tool glyph="#" label="#professional" onClick={() => actions.addTag('professional')} />
          <Tool glyph="#" label="#personal" onClick={() => actions.addTag('personal')} />
          <Tool glyph="#" label="#meeting" onClick={() => actions.addTag('meeting')} />
          <Tool glyph="#" label="#idea" onClick={() => actions.addTag('idea')} />
        </Group>
      </div>
    );
  }

  if (tab === 'View') {
    return (
      <div className="toolbar">
        <Group label="Navigate">
          <Tool glyph="▦" label="Today" tall onClick={actions.today} />
        </Group>
        <Group label="Data">
          <Tool glyph="↓" label="Export JSON" tall onClick={actions.exportJson} />
        </Group>
      </div>
    );
  }

  if (tab === 'Draw' || tab === 'File' || tab === 'Help') {
    return (
      <div className="toolbar">
        <Group label={tab}>
          <span style={{ color: 'var(--grey-90)', fontSize: 12, padding: '0 6px' }}>
            {tab === 'Draw'
              ? 'Inking arrives with the tablet work in a later phase.'
              : tab === 'File'
                ? 'Export and import live under View → Data for now.'
                : 'Ctrl K search · Ctrl J assistant · Ctrl [ / ] previous / next day'}
          </span>
        </Group>
      </div>
    );
  }

  // Home
  return (
    <div className="toolbar">
      <Group label="Basic Text">
        <Tool glyph="B" onClick={() => actions.wrapInline('**')} title="Bold" />
        <Tool glyph="I" onClick={() => actions.wrapInline('*')} title="Italic" />
        <Tool glyph="{ }" onClick={() => actions.wrapInline('`')} title="Inline code" />
      </Group>

      <Group label="Styles">
        <Tool glyph="H1" onClick={() => actions.setBlockType('HEADING', 1)} />
        <Tool glyph="H2" onClick={() => actions.setBlockType('HEADING', 2)} />
        <Tool glyph="H3" onClick={() => actions.setBlockType('HEADING', 3)} />
        <Tool glyph="¶" onClick={() => actions.setBlockType('TEXT')} title="Normal text" />
      </Group>

      <Group label="Lists">
        <Tool glyph="•" onClick={() => actions.setBlockType('BULLET')} title="Bullet list" />
        <Tool glyph="1." onClick={() => actions.setBlockType('NUMBER')} title="Numbered list" />
      </Group>

      <Group label="Tags">
        <Tool glyph="☑" label="To Do" tall onClick={() => actions.setBlockType('CHECKBOX')} />
        <Tool glyph="#" label="Professional" tall onClick={() => actions.addTag('professional')} />
        <Tool glyph="#" label="Personal" tall onClick={() => actions.addTag('personal')} />
      </Group>
    </div>
  );
}
