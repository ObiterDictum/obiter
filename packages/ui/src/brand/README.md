# Brand assets

Shared source-of-truth artwork for every Obiter surface. Lives here rather than
in `docs/` because apps consume it: favicons for web and marketing, the desktop
app icon, and anywhere the mark is needed as a file instead of as markup.

Import through the package export, never by relative path across workspaces:

```ts
import markUrl from '@obiter/ui/brand/obiter-mark.svg'
import favicon from '@obiter/ui/brand/logo/mark-32-ink-transparent.png'
```

## What is here

| Path                               | Use                                      |
| ---------------------------------- | ---------------------------------------- |
| `obiter-mark.svg`                  | The mark. Canonical vector source.       |
| `obiter-wordmark.svg`              | Mark plus OBITER type.                   |
| `obiter-app-icon-1024.png`         | Source for the desktop `.ico` / `.icns`. |
| `logo/mark-<size>-<colourway>.png` | Raster ladder, 16px to 1024px.           |

Colourways are `ink` (dark mark, light surfaces), `cream` (light mark, dark
surfaces), each as `-transparent`, plus `-on-sand` and `-on-night` where a baked
background is needed (favicons render badly on transparency in some clients).

## Not here

The mark rendered _in the app_ is markup, not a file:
`packages/app-shell/src/wordmark.tsx` draws it as inline JSX so it inherits
`currentColor` and tracks the theme. Change the shape in both places or they
drift.

`docs/brand/` keeps only the README lockups. The generated presentation kit
(guideline boards, application mockups, social renders) is gitignored: it was
40 MB of binaries that nothing in the repo referenced, and git would carry every
revision of it permanently.
