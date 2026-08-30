---
name: COVERT Specimen Room
description: A high-security policy specimen under live examination.
colors:
  mineral-navy: "#07111b"
  mineral-navy-raised: "#0a1723"
  mineral-navy-active: "#102231"
  frost-paper: "#d8d8d3"
  frost-paper-highlight: "#ecebe6"
  specimen-ink: "#101722"
  frost-metal: "#bac3c9"
  muted-instrument: "#7f8e98"
  registration-line: "#2a3b48"
  paper-rule: "#8c9293"
  security-violet: "#8c6bd6"
  oxidized-copper: "#c7794e"
  validation-mint: "#8fe1c1"
  failure-red: "#b64f55"
  pending-amber: "#d6a15e"
typography:
  display:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(3.2rem, 4.7vw, 5.8rem)"
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(3rem, 5.6vw, 5.8rem)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
  body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.1em"
rounded:
  square: "0"
  instrument: "2px"
  paper: "4px"
  round: "999px"
spacing:
  micro: "8px"
  tight: "12px"
  control: "18px"
  field: "20px"
  panel: "24px"
  gutter: "28px"
components:
  button-primary:
    backgroundColor: "{colors.security-violet}"
    textColor: "#ffffff"
    typography: "{typography.title}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "54px"
  button-primary-hover:
    backgroundColor: "#9d7de2"
    textColor: "#ffffff"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "54px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "#b99cff"
    typography: "{typography.title}"
    rounded: "{rounded.square}"
    padding: "0 20px"
    height: "54px"
  field-paper:
    backgroundColor: "rgba(255,255,255,.4)"
    textColor: "{colors.specimen-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "13px"
  panel-paper:
    backgroundColor: "{colors.frost-paper}"
    textColor: "{colors.specimen-ink}"
    rounded: "{rounded.instrument}"
    padding: "24px"
---

# Design System: COVERT Specimen Room

## Overview

__Creative North Star: "Specimen Room"__

COVERT presents a public financial policy as a high-security specimen under live examination. Mineral navy surrounds frost paper, security violet marks private routing, oxidized copper carries action and pending consequence, and mint validation ink records successful proof. Guilloche geometry, registration marks, narrow technical labels, and square controls make each screen feel inspected and authored.

The system stays dense, direct, and evidence-led. Public rules sit on paper or ledger surfaces. Private routing appears inside dark violet channels. Pending, recorded, successful, and failed states use explicit text beside color. The approved homepage centers an oversized split specimen with a draggable inspection slit, while product routes reuse the same dossier, packet, ledger, and evidence grammar.

__Key Characteristics:__

- High-security document materials instead of a generic privacy dashboard.
- Condensed display type paired with plain body text and tabular mono labels.
- Square instrument controls, 1px rules, and physical-paper depth.
- Violet private routes, copper actions, and mint verification marks.
- Honest evidence states with pending proof presented as pending.

## Colors

The palette moves between mineral-dark instrument space and frost-paper inspection surfaces, with three functional inks for privacy, action, and validation.

### Primary

- __Security Violet:__ Marks private routes, active tiers, primary actions, inspection stamps, and selected state. Keep violet concentrated around privacy and examination.

### Secondary

- __Oxidized Copper:__ Marks directional action, pending consequence, separators with authority, and the embossed specimen seal.

### Tertiary

- __Validation Mint:__ Marks recorded evidence, successful settlement, connected state, live route nodes, and keyboard focus.

### Neutral

- __Mineral Navy:__ Supplies the app shell and the darkest inspection field.
- __Raised Mineral Navy:__ Separates private channels, evidence sections, modals, and dark dossier panels.
- __Active Mineral Navy:__ Identifies hovered or active instrument rows without introducing a new hue.
- __Frost Paper:__ Carries public policy facts, forms, ledgers, and evidence dossiers.
- __Frost Paper Highlight:__ Provides high-contrast text on navy and the lightest paper layer.
- __Specimen Ink:__ Provides primary text on paper.
- __Frost Metal:__ Supports cool icon and brand details.
- __Muted Instrument:__ Supports low-priority labels and footer text on navy.
- __Registration Line:__ Divides dark rails, rows, and shell regions.
- __Paper Rule:__ Divides fields and data rows on paper.

### Named Rules

__The Functional Ink Rule.__ Violet means private or inspected, copper means action or pending consequence, and mint means validated or recorded. Never swap these roles for decoration.

__The Honest State Rule.__ Pair every state color with direct text such as MAINNET EVIDENCE PENDING, success, or error. Color never carries status alone.

## Typography

__Display Font:__ Barlow Condensed with a sans-serif fallback  
__Body Font:__ Barlow with a sans-serif fallback  
__Label and Mono Font:__ SFMono-Regular, Consolas, Liberation Mono, monospace

__Character:__ The display face supplies a tall, compressed security-document silhouette. Barlow keeps explanations readable, while the mono stack makes serials, hashes, readings, status marks, and field labels feel measured.

### Hierarchy

- __Display__ uses a bold condensed face, tight leading, and responsive sizing for hero claims and closing statements.
- __Headline__ uses the same condensed face for section titles and product-route titles.
- __Title__ uses compact uppercase condensed type for evidence steps, buttons, cards, and control labels.
- __Body__ uses regular Barlow for explanations, with important reading lines kept near 40 to 52 characters.
- __Label__ uses small uppercase mono text with wide tracking for statuses, serials, metadata, table heads, and measurements.

### Named Rules

__The Two-Voice Rule.__ Use condensed type for declarations and controls. Use mono for evidence and measurements. Keep paragraph copy in Barlow.

__The Compression Rule.__ Large headlines stay short, uppercase, and tightly led. Do not stretch the condensed display face into long paragraphs.

## Layout

The shell uses a precision top rail with separate brand, navigation, and wallet cells. At desktop widths, the homepage divides into a dominant specimen field and a narrower action rail. Product routes use bounded grids for dossiers, claim packets, verification rows, reserve metrics, and proof archives.

Spacing follows an 8px base rhythm. Dense controls and evidence rows use 8px to 24px internal spacing. Major sections use 56px to 110px vertical space and responsive gutters no smaller than 20px on content sections. Lines align neighboring cells and establish hierarchy before whitespace does.

At 1180px, columns tighten and complex claim content reduces to two columns. At 900px, the homepage specimen and action rail stack, page layouts collapse to one column, the navigation moves to a horizontally scrollable second row, and metric groups become vertical. At 620px, the specimen loses outer stage padding, its slit narrows from 92px to 64px, tier controls stack, paper panels use 19px padding, and footer content reduces to one column. The mobile specimen stays first and never introduces horizontal page overflow.

__The Specimen-First Rule.__ Preserve the public document before explanatory copy on narrow screens. The inspection interaction remains available at a reduced width.

__The Structural Line Rule.__ Use 1px registration rules to organize dense information. Reserve 2px violet or copper rules for focus, selection, or decisive boundaries.

## Elevation & Depth

The system uses physical depth only for paper objects. Specimens, dossiers, metrics, and modals receive broad dark shadows, while navy controls and rails stay flat. Paper texture and guilloche overlays create material separation without glass, blur, or floating card stacks.

### Shadow Vocabulary

- __Specimen depth__ (`0 22px 50px rgba(0,0,0,.32)`): Lifts the oversized policy specimen from its dark inspection stage.
- __Dossier depth__ (`0 16px 36px rgba(0,0,0,.2)`): Lifts paper panels and evidence blocks.
- __Modal depth__ (`0 26px 80px rgba(0,0,0,.45)`): Separates the wallet dialog from the dark backdrop.

### Named Rules

__The Paper-Only Depth Rule.__ Apply elevation to physical paper and modal layers. Keep buttons, navigation cells, status marks, and dark evidence rows flat.

## Shapes

Controls, navigation cells, evidence strips, fields, and status tags use square corners. Paper panels use a restrained 2px corner, while a document leaf uses no more than 4px. Circular geometry belongs to registration marks, status dots, reserve rings, guilloche rosettes, and the copper seal. It does not soften rectangular controls.

Borders stay thin and precise. Guilloche lines, measurement ticks, authored line icons, and registration crosses repeat the inspection grammar. Icons use square caps and geometric strokes. Avoid generic shield and padlock hero symbols.

__The Instrument Edge Rule.__ A control is square by default. Rounded pills do not belong in this system.

## Components

### Buttons

- __Shape:__ Square instrument plate with a 54px minimum height and 20px horizontal padding.
- __Primary:__ Security violet with white text. Use for the main action within a route or rail.
- __Secondary:__ Oxidized copper with mineral-navy text. Use for decisive settlement or directional action.
- __Ghost:__ Transparent navy surface with violet text and a violet 1px rule.
- __Hover and focus:__ Lift hover states by 2px. Use a two-ring navy and mint focus treatment. Remove motion under reduced-motion preferences.
- __Disabled:__ Reduce opacity to 42 percent, keep the state label legible, and remove pointer and lift behavior.

### Status Marks

- __Style:__ Small uppercase mono text, direct state language, and a geometric dot or scan icon.
- __Pending:__ Pending amber with explicit pending text.
- __Recorded or successful:__ Validation mint with explicit recorded or success text.
- __Failure:__ Failure red plus a written error or failure label.

### Cards / Containers

- __Corner Style:__ Restrained paper edge at 2px, or square for ledger blocks.
- __Background:__ Frost paper with the authored paper texture. Private or inverse containers use raised mineral navy.
- __Shadow Strategy:__ Paper-only depth from the Elevation section.
- __Border:__ Fine specimen-ink rules on paper and registration-line rules on navy.
- __Internal Padding:__ 24px desktop, 19px at small mobile widths.

### Inputs / Fields

- __Style:__ Square paper field with a 1px paper rule, translucent white fill, and specimen-ink text.
- __Focus:__ Use the global mint focus ring. Do not remove visible focus in favor of color-only border shifts.
- __Error and Disabled:__ Use failure red with written error copy. Preserve readable labels and values when a field is unavailable.

### Navigation

The desktop navigation occupies divided cells in the top rail. Labels use uppercase condensed type with wide tracking. Hover and current-page states turn white and reveal a 2px copper underline. At 900px and below, navigation moves beneath the brand and wallet controls into a 48px horizontally scrollable row.

### Inspection Specimen

The signature component combines frost security paper, guilloche geometry, registration marks, policy metadata, a copper seal, and a dark private channel. The range control moves the vertical channel between 35 and 65 percent. The channel holds the policy, anonymizer, and STRK20 open-note route in a single measured line. Keyboard focus outlines the whole channel in mint. On small screens, reduce the channel and node widths while retaining the same route and input.

### Evidence Strips and Ledgers

Evidence strips use full-width rows, 1px separators, authored geometric icons, an ordered index, and concise proof language. Ledger columns place public facts on paper and private relationships on navy. Recorded evidence and pending evidence must remain visually and verbally distinct.

## Do's and Don'ts

### Do:

- __Do__ preserve mineral navy, frost paper, security violet, oxidized copper, mint validation ink, and guilloche geometry as one material system.
- __Do__ keep public facts, private routes, and evidence states visually distinct.
- __Do__ use authored geometric line icons, registration marks, serials, rules, and tabular readings.
- __Do__ retain keyboard access for the inspection slit, visible mint focus, reduced-motion behavior, and text labels for every state.
- __Do__ label missing mainnet proof as pending until hashes, addresses, and media exist.
- __Do__ adapt dense grids into one-column dossiers before reducing readable text below established sizes.

### Don't:

- __Don't__ turn COVERT into a generic privacy dashboard, bento grid, or rounded card collection.
- __Don't__ add glass surfaces, generic gradients, neon cyberpunk effects, cream serif editorial styling, or rounded-pill overload.
- __Don't__ use elevation on flat instrument controls or dark evidence rows.
- __Don't__ use generic shield or padlock hero imagery.
- __Don't__ imply a transaction, deployment, customer, or verification exists before evidence records the claim.
- __Don't__ hide the public shielding boundary or describe beneficiary privacy more broadly than the implemented settlement path.
