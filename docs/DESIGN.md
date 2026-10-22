# Creative Flow design system

All colors live in `src/styles/tokens.ts` and are injected as CSS variables at startup. Components use semantic names only.

## Palette
Deep Focus Navy #172638 · Creative Blue #789DB8 · Sage Green #A8BFA7 · Warm Ivory #FAF7F0 · Soft Slate #E8EDF0 · Ink Charcoal #293443

## Color roles
| Role | Use | Tokens |
| --- | --- | --- |
| AI | AI creativity features only | `ai`, `ai-fg`, `ai-text`, `ai-soft` |
| Progress | Goal progress, completed goals, saved state | `progress`, `progress-text`, `progress-soft` |
| Alert | Corrections, warnings, destructive actions | `alert`, `alert-fg`, `alert-text`, `alert-soft` |
| Action | Primary buttons | `action`, `action-fg` |

Base hues are fills. Where colored text sits on a surface, a darker (light theme) or lighter (dark theme) tone of the same hue is used so it meets 4.5:1. Translucent text is not used.

## Writing modes
| Mode | Surround | Page | Accent | Behavior |
| --- | --- | --- | --- | --- |
| Creative Drafting (default) | Navy | Warm Ivory | Creative Blue | Full studio |
| Deep Focus | Muted green-gray | Soft off-white | Sage | Outline, history, toolbar and notifications hidden; save indicator and goal stay |
| Editing & Review | Soft Slate | White | Terracotta | Panels open for review work |

The mode, font size (15 to 28 px), line spacing (1.4 to 2.4), page width (narrow, standard, wide), theme, and daily goal are saved in `profiles.preferences` in Supabase. The newer of the device copy and the server copy wins, so a change made just before closing a tab is not lost.

## Contrast guarantees
- Manuscript text on every page color: at least 7:1.
- All other text: at least 4.5:1. Control borders, focus ring, and meaningful fills: at least 3:1.
- Enforced by `tokens.test.ts` and by axe in `e2e/design.spec.ts`.
