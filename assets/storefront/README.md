# Chip Savage Storefront Art

Generated promotional artwork built entirely from the game's existing sprites and backgrounds.

| File                              |        Size | Intended use                                        |
| --------------------------------- | ----------: | --------------------------------------------------- |
| `feature-graphic-1024x500.png`    |  1024 x 500 | Google Play feature graphic                         |
| `store-poster-1080x1350.png`      | 1080 x 1350 | Portrait promotional post or store editorial art    |
| `social-preview-1200x630.png`     |  1200 x 630 | Open Graph and social sharing preview                |

Regenerate all exports from the repository root:

```powershell
npm run build:storefront
```

The generator uses `bg_2.png`, the third frame of `chip_kick.png`, and the third frame of
`boss_attack1.png`. Edit `scripts/generate-storefront-art.mjs` to change the composition.

These are promotional images, not gameplay screenshots. Store screenshot slots should use
unedited captures of the game UI so the listing accurately represents play.
