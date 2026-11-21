import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Side elevations: a continuous landing edge with detail below the player's feet.
const tiles = {
  platform_tile: `
    <rect width="96" height="24" fill="#62432f"/>
    <path d="M0 11h96v3H0z" fill="#50392d"/>
    <path d="M0 7h96v3L83 9l-5 3-13-2-8 3-12-3-7 2-9-2-8 3-12-3-9 1z" fill="#8d713d"/>
    <path d="M0 0h96v7L84 6l-8 3-11-2-9 2-9-3-10 2-12-1-8 2-8-3-9 1z" fill="#456d38"/>
    <path d="M0 0h96v3H0z" fill="#98c765"/>
    <path d="M6 4l8-2 2 2-9 1zm26 1 11-2-4 3zm31-2 10-1-3 3zm18 2 7-1-3 2z" fill="#74a94f"/>
    <path d="M0 15h15l4 4-5 2H0zm24-1h17l-3 4H26zm24 3h12l4 4H45zm20-4h13l-2 5H66zm20 2h8v6H86z" fill="#966947"/>
    <path d="M0 22h96v2H0z" fill="#44352c"/>`,
  platform2_tile: `
    <rect width="96" height="24" fill="#643e2a"/>
    <path d="M0 0h96v5H0z" fill="#d2a468"/><path d="M0 1h96v1H0z" fill="#edc58e"/>
    <path d="M0 6h96v7H0z" fill="#a16b42"/><path d="M0 15h96v6H0z" fill="#875237"/>
    <path d="M0 9h12q7-3 16 0l11 1H24q-7-2-12 0H0zm48 8h12q8 3 19 0h12v1H80q-10 4-22 0H48z" fill="#70462f"/>
    <path d="M35 2h2v11h-2zm41 13h2v6h-2z" fill="#513b32"/>
    <path d="M3 5h8v17H3z" fill="#444d46"/><path d="M4 5h2v17H4z" fill="#7a8775"/>
    <circle cx="7" cy="8" r="1.5" fill="#ddc794"/><circle cx="7" cy="19" r="1.5" fill="#beb69a"/>
    <path d="M0 22h96v2H0z" fill="#40352c"/>`,
  platform3_tile: `
    <rect width="96" height="24" fill="#384650"/>
    <path d="M0 0h96v4H0z" fill="#b0beb4"/><path d="M0 4h96v2H0z" fill="#6c8180"/>
    <path d="M0 7h22l-2 6H0zm25 0h28l3 5-4 1H23zm31 0h28l-2 6H59zm31 0h9v6H85z" fill="#82928e"/>
    <path d="M0 15h8l2 5H0zm11 0h26l-3 6H13zm29 0h31l-2 6H37zm34 0h22v5H72z" fill="#677a7c"/>
    <path d="M2 7h18l-3 2H2zm25 0h20l-5 2H26zm32 0h21l-4 2H60zm-45 8h19l-5 2H15zm28 0h24l-7 2H42z" fill="#a3afa6"/>
    <path d="M44 8l-3 3 3 2m32 3-3 3" fill="none" stroke="#51666a"/>
    <path d="M0 22h96v2H0z" fill="#303e46"/>`
};

for (const [name, body] of Object.entries(tiles)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24">${body}</svg>`;
  const out = new URL(`../assets/sprites/backgrounds/tiles/${name}.png`, import.meta.url);
  await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(out));
}
