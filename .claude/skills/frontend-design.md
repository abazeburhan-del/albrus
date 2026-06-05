---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use when the user wants to build web components, pages, or applications. Produces creative, polished code that avoids generic AI aesthetics.
metadata:
  author: Anthropic
  source: skillsmp.com/skills/anthropics-claude-code-plugins-frontend-design-skills-frontend-design-skill-md
---

## Design Thinking (Before Coding)

Understand context and commit to a BOLD aesthetic direction:

- **Purpose:** What problem does the interface solve? Who uses it?
- **Tone:** Choose one: minimalist, maximalist, retro-futuristic, organic, luxury, playful, editorial, brutalist, art deco, soft, industrial, etc.
- **Constraints:** Technical requirements
- **Differentiation:** What makes it MEMORABLE?

**CRITICAL:** Pick a clear conceptual direction and apply it decisively.

## Frontend Aesthetics Guide

### Typography
- Avoid generic fonts (Inter, Roboto, Arial, system fonts)
- Choose distinctive, characterful type pairings
- Use variable fonts for dynamic expression
- Scale creates hierarchy — be bold with size contrast

### Color & Theme
- Pick a cohesive aesthetic; use CSS custom properties
- Dominant neutrals + sharp accents hit harder than rainbow palettes
- Dark themes: rich darks (not pure #000), layered surface colors
- Light themes: warm whites, intentional tints

### Motion
- Animations and micro-interactions should feel earned
- Prioritize CSS-only solutions (no JS library bloat)
- High-impact moments: staggered reveals on page load, hover states, transitions
- Duration: 150–400ms for UI feedback, 600–1200ms for reveals

### Spatial Composition
- Unexpected layouts, asymmetry, overlap
- Diagonal flow, grid-breaking elements
- Generous whitespace — breathing room signals quality
- Z-axis layering: shadows, blurs, stacked elements

### Backgrounds & Visual Detail
- Create atmosphere and depth
- Gradient meshes, noise textures, geometric patterns
- Layered transparencies, glassmorphism used sparingly
- Subtle grain or texture elevates flat designs

## Never Use
- Overused font families (Inter, Roboto, Arial, system fonts)
- Cliché color schemes (especially purple gradients)
- Predictable card-grid-hero layouts without a twist
- Cookie-cutter design that lacks context-specific character
- Generic "AI slop" aesthetic — everything centered, purple glow, floating orbs

## Code Standards
- Pure CSS animations preferred over JS
- CSS custom properties for all design tokens
- Mobile-first responsive design
- Semantic HTML for accessibility
- No unnecessary dependencies

## Output Format
1. State the chosen aesthetic direction (1 sentence)
2. Deliver complete, copy-pasteable code
3. HTML + CSS in one file unless told otherwise
4. Include hover states, focus states, transitions
5. Comment only non-obvious design decisions
