import React from 'https://esm.sh/react@18.3.1';
import ReactDOM from 'https://esm.sh/react-dom@18.3.1/client';

const STORAGE_KEY = 'onenote-app-state';

const NOTEBOOKS = [
  {
    id: 'work',
    name: 'Work Notebook',
    color: '#7c3aed',
    pages: [
      {
        id: 'weekly-meeting',
        section: 'Meetings',
        title: 'Weekly Meeting',
        date: 'Monday, December 3, 2018',
        time: '11:30am',
        summary: 'Review goals, actions, and next steps for the work notebook team.',
        content:
          'This note is your central summary of the weekly working session. Capture action items, assigned owners, and follow-up points in a structured note page.',
      },
      {
        id: 'event-planning',
        section: 'Meetings',
        title: 'Event Planning',
        date: 'Thursday, January 10, 2019',
        time: '2:00pm',
        summary: 'Plan the summer event calendar and cross-team coordination.',
        content:
          'Use this note to map event milestones, stakeholders, and promotion strategy. Keep the schedule up to date as requirements evolve.',
      },
      {
        id: 'bike-fix-day',
        section: 'Meetings',
        title: 'Bike Fix Day',
        date: 'Monday, December 3, 2018',
        time: '11:30am',
        summary: 'Inventory and workshop planning for the bike repair event.',
        content:
          'This note includes the schedule and crew assignments for Bike Fix Day. Add preparation steps, checklists, and follow-up notes to keep the team aligned.',
        table: [
          { date: 'January 12', schedule: '9am–2pm Mack, Whitney, Jay' },
          { date: 'January 13', schedule: '1–4pm Toby, Mack, Whitney' },
        ],
        imageAlt: 'A person with a bicycle frame',
      },
      {
        id: 'gear-sale',
        section: 'Meetings',
        title: 'Gear Sale',
        date: 'Friday, March 1, 2019',
        time: '10:00am',
        summary: 'Coordinate inventory and marketing for the gear sale.',
        content:
          'Review pricing, product availability, and customer outreach items in this note before the gear sale kickoff.',
      },
    ],
  },
  {
    id: 'family',
    name: 'Family Notebook',
    color: '#f97316',
    pages: [
      {
        id: 'vacation-ideas',
        section: 'Personal',
        title: 'Vacation Ideas',
        date: 'Saturday, April 20, 2024',
        time: '10:00am',
        summary: 'Capture the best family trip ideas for the year.',
        content: 'A quick note to collect locations, budgets, and travel must-haves for everyone in the family.',
      },
    ],
  },
  {
    id: 'finances',
    name: 'Finances',
    color: '#0ea5e9',
    pages: [
      {
        id: 'budget-review',
        section: 'Administration',
        title: 'Budget Review',
        date: 'Wednesday, May 8, 2024',
        time: '3:00pm',
        summary: 'Outline the next quarter budget items and approvals.',
        content: 'Track recurring costs, forecasted spend, and approvals in this notebook section.',
      },
    ],
  },
];

const TABS = ['Home', 'Insert', 'Draw', 'View'];

const create = React.createElement;

const Header = ({ selectedTab, onSelectTab }) =>
  create(
    'header',
    { className: 'app-header' },
    create('div', { className: 'toolbar' },
      create(
        'nav',
        { className: 'tab-list' },
        TABS.map((tab) =>
          create(
            'button',
            {
              key: tab,
              type: 'button',
              className: tab === selectedTab ? 'tab tab-active' : 'tab',
              onClick: () => onSelectTab(tab),
            },
            tab
          )
        )
      ),
      create(
        'div',
        { className: 'header-actions' },
        create('button', { type: 'button', className: 'icon-button' }, '🔍'),
        create('button', { type: 'button', className: 'icon-button' }, 'A'),
        create('button', { type: 'button', className: 'icon-button' }, '✓')
      )
    )
  );

const NotebookList = ({ notebooks, selectedNotebook, onSelect }) =>
  create(
    'aside',
    { className: 'canvas-panel notebook-panel' },
    create('div', { className: 'panel-header' },
      create('span', { className: 'panel-title' }, 'Notebooks')
    ),
    create(
      'ul',
      { className: 'item-list' },
      notebooks.map((notebook) =>
        create(
          'li',
          {
            key: notebook.id,
            className: notebook.id === selectedNotebook ? 'item item-active' : 'item',
            onClick: () => onSelect(notebook.id),
          },
          create('span', { className: 'color-tab', style: { background: notebook.color } }),
          create('span', { className: 'item-label' }, notebook.name)
        )
      )
    )
  );

const SectionList = ({ sections, selectedSection, onSelect }) =>
  create(
    'aside',
    { className: 'canvas-panel section-panel' },
    create('div', { className: 'panel-header' },
      create('span', { className: 'panel-title' }, 'Sections')
    ),
    create(
      'ul',
      { className: 'item-list' },
      sections.map((section) =>
        create(
          'li',
          {
            key: section,
            className: section === selectedSection ? 'item item-active' : 'item',
            onClick: () => onSelect(section),
          },
          create('span', { className: 'item-label' }, section)
        )
      )
    )
  );

const PageList = ({ pages, selectedPage, onSelect }) =>
  create(
    'aside',
    { className: 'canvas-panel page-panel' },
    create('div', { className: 'panel-header' },
      create('span', { className: 'panel-title' }, 'Pages')
    ),
    create(
      'ul',
      { className: 'page-list-grid' },
      pages.map((page) =>
        create(
          'li',
          {
            key: page.id,
            className: page.id === selectedPage ? 'page-item page-item-active' : 'page-item',
            onClick: () => onSelect(page.id),
          },
          create('strong', null, page.title),
          create('p', null, page.summary)
        )
      )
    )
  );

const NotePreview = ({ page }) =>
  create(
    'article',
    { className: 'preview-panel' },
    create(
      'div',
      { className: 'preview-header' },
      create('div', null,
        create('span', { className: 'label small-label' }, page.section),
        create('h2', null, page.title)
      ),
      create('div', { className: 'meta-row' },
        create('span', null, page.date),
        create('span', null, page.time)
      )
    ),
    create('p', { className: 'preview-summary' }, page.summary),
    page.table &&
      create(
        'table',
        { className: 'preview-table' },
        create('thead', null,
          create('tr', null,
            create('th', null, 'Date'),
            create('th', null, 'Work Schedule')
          )
        ),
        create(
          'tbody',
          null,
          page.table.map((row) =>
            create(
              'tr',
              { key: row.date },
              create('td', null, row.date),
              create('td', null, row.schedule)
            )
          )
        )
      ),
    page.imageAlt &&
      create('div', { className: 'preview-image' },
        create('div', { className: 'preview-image-box' },
          create('span', { className: 'preview-image-label' }, page.imageAlt)
        )
      ),
    create('p', null, page.content)
  );

const App = () => {
  const initialState = React.useMemo(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.warn('Invalid saved state:', error);
      }
    }
    return {
      selectedNotebook: 'work',
      selectedSection: 'Meetings',
      selectedPage: 'bike-fix-day',
      selectedTab: 'Home',
    };
  }, []);

  const [state, setState] = React.useState(initialState);

  React.useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentNotebook = NOTEBOOKS.find((notebook) => notebook.id === state.selectedNotebook) || NOTEBOOKS[0];
  const sections = [...new Set(currentNotebook.pages.map((page) => page.section))];
  const currentSection = sections.includes(state.selectedSection) ? state.selectedSection : sections[0];
  const pages = currentNotebook.pages.filter((page) => page.section === currentSection);
  const currentPage = pages.find((page) => page.id === state.selectedPage) || pages[0];

  const selectNotebook = (notebookId) => {
    const notebook = NOTEBOOKS.find((item) => item.id === notebookId);
    const firstSection = [...new Set(notebook.pages.map((page) => page.section))][0];
    const firstPage = notebook.pages.find((page) => page.section === firstSection)?.id;
    setState({
      selectedNotebook: notebookId,
      selectedSection: firstSection,
      selectedPage: firstPage,
      selectedTab: state.selectedTab,
    });
  };

  const selectSection = (section) => {
    const firstPage = currentNotebook.pages.find((page) => page.section === section)?.id;
    setState((prev) => ({ ...prev, selectedSection: section, selectedPage: firstPage }));
  };

  const selectPage = (pageId) => setState((prev) => ({ ...prev, selectedPage: pageId }));
  const selectTab = (tab) => setState((prev) => ({ ...prev, selectedTab: tab }));

  return create(
    'div',
    { className: 'app-shell' },
    create(Header, { selectedTab: state.selectedTab, onSelectTab: selectTab }),
    create(
      'div',
      { className: 'canvas-grid' },
      create(NotebookList, {
        notebooks: NOTEBOOKS,
        selectedNotebook: state.selectedNotebook,
        onSelect: selectNotebook,
      }),
      create(SectionList, {
        sections,
        selectedSection: currentSection,
        onSelect: selectSection,
      }),
      create(PageList, {
        pages,
        selectedPage: currentPage?.id,
        onSelect: selectPage,
      }),
      create(NotePreview, { page: currentPage })
    )
  );
};

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(create(App));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((registration) => {
        console.log('Service worker registered:', registration.scope);
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}
