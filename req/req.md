# Build: AI-Powered Personal Work Notebook

Act as a Principal Architect, UX Designer, and Senior Full-Stack Engineer.

Build a modern personal productivity/work notebook inspired by the simplicity of Microsoft OneNote, but designed specifically for tracking my daily professional and personal activities.

The core concept is:

ONE NOTE / ONE WORKSPACE

I should not feel like I am managing multiple projects, boards, or complicated task-management screens.

I should open the application and continuously capture everything I do during the day in a single note.

--------------------------------------------------
1. CORE UX
--------------------------------------------------

The application should have a single primary notebook/workspace.

The main screen should look and behave like a digital notebook.

Example:

--------------------------------------------------
Today — August 8, 2026
--------------------------------------------------

☐ Finish architecture design
   Priority: High
   Professional
   2h

☑ Review PR #123
   Professional
   45m

📝 Meeting with platform team
   Notes:
   Discussed Kafka notification flow...

☐ Buy groceries
   Personal
   Priority: Medium

📝 Ideas
   - Improve onboarding
   - AI recommendation engine
   - Weekly productivity report

--------------------------------------------------

Everything belongs to the same daily note.

Do NOT create separate pages for every task.

Do NOT make the primary UX look like Jira/Trello/Asana.

The note should feel natural and free-form.

--------------------------------------------------
2. NOTE STRUCTURE
--------------------------------------------------

Each day has one primary note.

Example:

2026-08-08
    Morning
    Tasks
    Meetings
    Notes
    Ideas
    Personal
    End of Day

However, these sections should NOT be mandatory.

The user should be able to freely type, paste, create checkboxes, add headings, lists, links, tables, etc.

Support rich text editing.

The user should be able to mix:

- Text
- Checkboxes
- Headings
- Bullet lists
- Numbered lists
- Tables
- Links
- Tags
- Images
- Code snippets
- Task items

within the same note.

--------------------------------------------------
3. PROFESSIONAL / PERSONAL
--------------------------------------------------

Do not create separate applications or separate workspaces.

Use lightweight classification:

PROFESSIONAL
PERSONAL

This can be represented using:

- Tags
- Labels
- Colors
- Filters

Example:

#professional
#personal
#meeting
#idea
#priority-high

The same note can contain both professional and personal information.

Allow filtering/searching by these classifications.

--------------------------------------------------
4. TASK CAPABILITY
--------------------------------------------------

Any checkbox inside the note can behave as a task.

Tasks should support:

- Completed / incomplete
- Priority
- Due date
- Estimated effort
- Actual effort
- Tags
- Professional / Personal
- Optional reminder

Tasks should be reorderable using drag and drop.

The user should be able to move task blocks anywhere inside the note.

Do NOT force users into a predefined Kanban workflow.

--------------------------------------------------
5. DATE / HISTORY NAVIGATION
--------------------------------------------------

Provide a lightweight left sidebar.

It should contain:

Today
Yesterday
This Week
Calendar
This Month

Show historical daily notes.

Example:

August 2026
  Aug 8  ●●●
  Aug 7  ●●
  Aug 6  ●●●●
  Aug 5  ●

The indicators should represent activity/productivity.

Clicking a date opens that day's single note.

Provide month and year navigation.

--------------------------------------------------
6. SEARCH — VERY IMPORTANT
--------------------------------------------------

Search should be a first-class capability.

The user may accumulate thousands of notes over time.

Implement fast global search across:

- Note content
- Tasks
- Headings
- Tags
- Dates
- Professional/Personal
- Completed tasks
- Meetings
- Ideas

Examples:

"Kafka"
"architecture"
"things I worked on last week"
"personal tasks"
"high priority"
"meetings with John"

Search results should show:

Date
Matched text
Context
Relevant section

Clicking a result should open the note and highlight the matched content.

Support filters:

Date
Professional / Personal
Tags
Completed / Pending
Priority

Design the search architecture so it can scale to a large amount of historical data.

--------------------------------------------------
7. AI INTELLIGENCE
--------------------------------------------------

AI should be a core capability, but NOT interfere with the basic note-taking experience.

The application should understand the user's historical notes.

Provide an optional AI assistant panel.

Examples:

"What did I accomplish this week?"

"What were my biggest priorities?"

"Show everything related to Game Recommendations."

"What tasks did I carry forward?"

"What did I spend most of my time on?"

"Summarize my professional work this week."

"Summarize my personal activities this month."

"What should I focus on tomorrow?"

"Find all notes where I discussed Kafka."

"Create a weekly summary from my notes."

AI should be able to retrieve relevant historical information using search/RAG before generating answers.

Do NOT allow the LLM to directly query the database.

Create a controlled AI service/tool layer.

--------------------------------------------------
8. AI PRODUCTIVITY INSIGHTS
--------------------------------------------------

Automatically derive insights from notes and tasks.

Weekly:

- What I accomplished
- Pending tasks
- Carried-forward tasks
- High-priority completed work
- Professional vs Personal activity
- Estimated vs actual effort
- Major topics discussed
- Important meetings
- Ideas captured
- Productivity trends

Example:

"You completed 18 of 23 tasks this week."

"Most of your professional effort was spent on platform architecture."

"4 tasks were carried forward more than once."

"Your highest productivity day was Wednesday."

Keep insights concise and actionable.

--------------------------------------------------
9. AI NOTE ASSISTANCE
--------------------------------------------------

Inside the note, provide optional AI actions:

- Summarize
- Rewrite
- Convert text → task
- Extract tasks
- Extract action items
- Generate meeting summary
- Categorize Professional/Personal
- Suggest priority
- Create follow-up tasks
- Find related historical notes

Example:

User writes:

"Discussed Gem Shop release with the team. Need to verify Kafka notification flow tomorrow."

AI can suggest:

☐ Verify Kafka notification flow
Due: Tomorrow
Category: Professional

The user must approve AI-created tasks.

--------------------------------------------------
10. ARCHITECTURE
--------------------------------------------------

Use a clean modular architecture:

UI
 ↓
Application Services
 ↓
Domain
 ↓
Data Access
 ↓
Database

Separate:

Note Service
Task Service
Search Service
AI Service
Analytics Service
Authentication Service

The AI layer should use:

Note Retrieval
 ↓
Search / Vector Retrieval
 ↓
Relevant Context
 ↓
LLM
 ↓
Response

Use hybrid search where appropriate:

Keyword Search + Semantic Search

The architecture should allow the AI provider/model to be changed later.

--------------------------------------------------
11. DATA MODEL
--------------------------------------------------

Core entities:

User
DailyNote
NoteBlock
Task
Tag
Attachment
AIConversation
AIInsight

A DailyNote represents the primary note for a date.

A NoteBlock represents content inside the note.

NoteBlock types may include:

TEXT
HEADING
CHECKBOX
TABLE
IMAGE
CODE
DIVIDER

Keep the data model flexible so new block types can be added later.

--------------------------------------------------
12. MVP
--------------------------------------------------

Phase 1:

- Authentication
- Single daily note
- Rich text editor
- Checkbox tasks
- Professional/Personal tags
- Priority
- Date navigation
- Persistence
- Basic search

Phase 2:

- Calendar
- Drag/drop blocks
- Advanced search
- Tags
- Attachments
- Weekly summary
- Productivity analytics

Phase 3:

- AI assistant
- Semantic search
- RAG
- AI task extraction
- AI summaries
- Historical insights

Phase 4:

- Voice input
- Mobile/PWA
- Reminders
- Recurring tasks
- Advanced productivity intelligence

Do not over-engineer the MVP.

--------------------------------------------------
13. UX PRINCIPLES
--------------------------------------------------

The application should feel like:

"Open → Write → Check things off → Close."

Not:

"Open → Create project → Create board → Create task → Assign category → Move card..."

Prioritize:

- Extremely fast note creation
- Minimal clicks
- Keyboard-first interaction
- Clean typography
- Large writing area
- Minimal UI
- Powerful search
- AI when needed, not constantly visible
- Excellent historical navigation

The note itself should remain the hero of the application.

--------------------------------------------------
14. ARCHITECTURE DOCUMENTATION
--------------------------------------------------

Before implementation:

1. Inspect the existing repository.
2. Identify the existing technology stack.
3. Create architecture.md.
4. Create requirements.md.
5. Create design.md.

design.md must contain:

- UX architecture
- Component architecture
- System architecture
- Data model
- Search architecture
- AI/RAG architecture
- API/service architecture
- Deployment architecture
- Security considerations

Then implement the application incrementally.

Do not introduce unnecessary infrastructure.

Prefer simple, maintainable solutions.

--------------------------------------------------
15. FINAL PRODUCT PRINCIPLE
--------------------------------------------------

The product should ultimately become:

"My personal searchable memory and daily work notebook."

I should be able to record everything naturally today and, months later, ask:

"What was I working on in August?"

"What did I decide about X?"

"Show me everything related to Game Recommendations."

"What did I accomplish last week?"

"What commitments are still pending?"

"What were my important meetings?"

"What ideas did I capture?"

The system should answer these questions using my historical notes and tasks.