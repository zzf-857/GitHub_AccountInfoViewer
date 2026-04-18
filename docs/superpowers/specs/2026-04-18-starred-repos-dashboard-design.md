# GitHub Starred Repositories Dashboard Design

## Goal

Build a high-readability dark data product for reviewing a personal GitHub starred repository collection. The dashboard should help the user understand technical interests, collection structure, and notable repositories with low visual fatigue.

## Current Problems

- Information density is too high.
- Text is too small for long reading.
- Charts and tables compete for attention.
- Too many borders create visual noise.
- The repository list is difficult to scan.

## Recommended Direction: Insight Console

Use an insight-first dashboard modeled after restrained dark data products such as GitHub, Linear, Vercel, and Stripe Dashboard. The experience should prioritize reading and decision-making over raw density.

The page should guide the user through this order:

1. See account and sync status.
2. Read the main collection insights.
3. Understand language and topic structure.
4. Scan repositories comfortably.
5. Open details only when needed.

## Information Architecture

Primary structure:

- Top utility bar: account, last sync time, refresh state, global search.
- Insight summary: 3 to 5 plain-language findings about the current starred collection.
- KPI row: total repositories, active languages, top topic, recently starred count.
- Interest structure: language distribution, top topics, recent star timeline.
- Repository list: scan-first list with filters and saved views.
- Detail drawer: expanded metadata, description, topics, links, and notes.

The repository list is the main reading surface. Charts support the list instead of dominating the page.

## Layout

Use a two-column desktop layout:

- Left sidebar: 240px to 260px, dedicated to filters and saved views.
- Main content: fluid width, max readable content width around 1440px.
- Main spacing: 24px page padding, 20px between major sections, 12px to 16px inside compact groups.

Desktop main content order:

1. Top utility bar.
2. Insight summary band.
3. KPI row.
4. Chart row.
5. Repository list.

Mobile and narrow layout:

- Filters collapse into a top sheet or horizontal filter chips.
- Charts stack vertically.
- Repository cards become single-column rows.

## Typography And Readability

Increase the overall text scale. The dashboard should feel readable at normal desktop distance without browser zoom.

Recommended type scale:

- Page title: 30px font size, 38px line height, weight 600.
- Section title: 20px font size, 30px line height, weight 600.
- KPI value: 34px font size, 40px line height, weight 600.
- Repository title: 17px font size, 26px line height, weight 600.
- Main body and repository description: 16px font size, 26px line height, weight 400.
- Filter controls and buttons: 15px font size, 22px line height, weight 500.
- Metadata and helper text: 14px font size, 22px line height, weight 400.
- Tags and chart labels: 13px font size, 18px line height, weight 500.

Hard limits:

- No primary reading text below 15px.
- No chart labels below 13px.
- Repository descriptions should use at least 16px.
- Avoid negative letter spacing.
- Use 1.55 to 1.65 line-height for paragraphs and descriptions.

## Color System

Use neutral dark surfaces with restrained accents:

- Page background: `#0A0A0B`.
- Primary surface: `#111214`.
- Raised surface: `#17181B`.
- Hover surface: `#1D1F23`.
- Primary text: `#F3F4F6`.
- Secondary text: `#A3AAB5`.
- Muted text: `#717985`.
- Hairline border: `rgba(255,255,255,0.08)`.
- Strong border: `rgba(255,255,255,0.14)`.
- Accent teal: `#3DD6C6`.
- Accent green: `#8BD17C`.
- Accent amber: `#F4C95D`.
- Accent rose: `#FF7A90`.

Avoid dominant purple-blue gradients, dense border grids, and one-color themes. Accent colors should be used for meaning, not decoration.

## Chart Design

Charts should answer one question each and remain visually subordinate to insights and the repository list.

Recommended chart modules:

- Top languages: horizontal bar chart, sorted descending, top 8 to 10 items.
- Topic map: compact ranked topic chips or a restrained treemap.
- Recent stars: simple timeline or monthly histogram.

Chart rules:

- Prefer horizontal bars over pie charts for readability.
- Place one natural-language insight under each chart.
- Use large chart labels, at least 13px.
- Keep chart height around 240px to 280px.
- Reduce grid lines and axis noise.
- Use muted colors for non-selected data and one accent for focus.

## Repository List

Replace dense table scanning with repository rows/cards.

Each repository row should contain:

- Repository full name as the primary anchor.
- Owner/repo hierarchy with owner muted and repo emphasized.
- Description, clamped to 2 lines by default.
- Language color dot and language name.
- Stars, forks, last update date, and archived status when available.
- Topic chips, limited to 3 to 5 visible chips.
- Optional Chinese supplement, collapsed by default.

List readability rules:

- Row height should be around 96px to 120px.
- Row padding should be 18px to 20px.
- Use 16px description text and 17px title text.
- Use dividers sparingly; prefer spacing and hover surfaces over heavy borders.
- Do not use vertical table grid lines.
- Keep interactive controls aligned to predictable locations.

## Filtering And Interaction

Primary filters:

- Search by repository name, owner, description, or topic.
- Language.
- Topic.
- Last updated range.
- Star count range.
- Archived or active.
- Has description / missing description.

Interaction rules:

- Selected filters appear as removable chips above the list.
- Global search supports keyboard focus with `/`.
- Filter changes update result count immediately.
- Saved views include: All, AI/LLM, Frontend, DevTools, Data, Recently Starred.
- The result summary should explain the filtered set in plain language.

Example summary:

`42 repositories match. Most are TypeScript and Python projects, with AI tooling as the strongest topic.`

## Empty States

No data state:

- Title: `No starred repositories loaded`
- Body: `Connect a GitHub token or import an exported starred repository file to start exploring your collection.`
- Actions: `Connect GitHub`, `Import file`, `Load sample data`.

No filter results state:

- Title: `No repositories match these filters`
- Body: `Try clearing search, widening the language filter, or resetting all filters.`
- Actions: `Clear search`, `Reset filters`.

## Loading States

Use skeleton loading rather than a large spinner:

- Top status skeleton.
- KPI skeleton blocks.
- Chart skeleton panels.
- Repository row skeletons with title, metadata, and description lines.

When refreshing live data, keep the previous data visible and show a subtle status message:

`Refreshing starred repositories... last data remains visible.`

## How This Improves Efficiency

Reading efficiency improves because:

- Primary text is larger and line-height is more generous.
- The list uses a single dominant scan path instead of table columns.
- Metadata is secondary and visually quieter.
- Charts answer specific questions instead of competing for attention.
- Borders are replaced by spacing, surface changes, and typographic hierarchy.

Information retrieval improves because:

- The top of the page summarizes insights before raw data.
- Filters produce immediate plain-language summaries.
- Saved views let the user revisit recurring interest areas quickly.
- Repository details are deferred to a drawer, keeping the main list stable.

## Alternative Direction: Library Map

Library Map organizes repositories as a personal technical knowledge library.

Structure:

- Left: topic tree.
- Center: grouped repository collections.
- Right: current topic insight panel.

This direction is strong for long-term curation and knowledge review, but it needs stronger topic classification. It is better as a second phase after the Insight Console redesign.

## Recommendation

Implement the Insight Console direction first. It addresses the current readability and fatigue issues directly while staying close to the existing dashboard architecture. The larger typography requirement should be treated as a core design constraint, not a later polish pass.
