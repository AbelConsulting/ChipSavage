# Chip App Icons

Run `npm run build:icons` to regenerate the icons from Chip's idle sprite.

- `chip-play-store-512.png`: opaque 512x512 PNG for the Google Play store listing.
- `chip-maskable-192.png`, `chip-maskable-512.png`, `chip-maskable-1024.png`: full-bleed web icons. The character fits within the centered 80%-diameter maskable safe circle.
- `app.webmanifest`: browser icon declarations, copied with the assets into the web bundle.
- Android adaptive foregrounds and legacy square/round launcher PNGs are generated into all five `android/app/src/main/res/mipmap-*` density folders.

Android adaptive icons use a transparent foreground with the character inside the centered 66dp-diameter safe circle on a 108dp canvas. The background color is defined in `android/app/src/main/res/values/ic_launcher_background.xml` and must match the generator's background color.

After generation, run `npm run cap:sync:android` and `npm run cap:build:aab` to package the icons into the signed release bundle.