# seasonal-sky

A sky for your website. Leaves, petals, snow, rain, storms, fog and the odd rainbow, chosen from the **season**, the **time of day** and the **live weather**, and pushed around by the cursor.

```ts
import { mountSky } from "seasonal-sky";

mountSky(); // that's it
```

No keys, no config, no dependencies. About 12 kB gzipped.

- **It composes.** Season, time and weather are mixed, not looked up: a summer shower by day makes a rainbow, a winter storm is a blizzard, an autumn storm throws the leaves sideways, a warm summer night has fireflies.
- **It's real.** Weather comes from [Open-Meteo](https://open-meteo.com) (free, no key). Dawn and dusk follow the actual sun. Rain turns to sleet when it's cold. Drizzle and downpour look different. The wind blowing outside blows in the sky.
- **It's alive.** Move the pointer through it, click the page, scroll. Rain stops at an invisible umbrella around your cursor.
- **It's polite.** Never blocks a click. Fades between skies. Backs off on slow machines. Draws nothing for `prefers-reduced-motion`. Lightning is one soft low-contrast pulse, never a flicker.

## Install

```sh
npm install seasonal-sky
```

## Use

```ts
import { mountSky } from "seasonal-sky";

const sky = mountSky({
  weather: "live",        // "live" | "none" | "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm"
  season: "auto",         // "auto" | "spring" | "summer" | "autumn" | "winter"
  time: "auto",           // "auto" | "dawn" | "day" | "dusk" | "night"
  onChange: (s) => console.log(s.season, s.weather, s.source),
});

sky.set({ weather: "storm" });   // change it later
sky.destroy();                   // and take it off the page
```

### React / Next.js

```tsx
"use client";
import { SeasonalSky, useSky } from "seasonal-sky/react";

export function Layout({ children }) {
  return (
    <>
      <SeasonalSky weather="live" />
      {children}
    </>
  );
}

// or read what's on screen:
const state = useSky({ weather: "live" }); // { season, phase, weather, source, … } | null
```

It only touches the DOM inside an effect, so server and client markup match.

## Options

| Option | Default | |
| --- | --- | --- |
| `weather` | `"live"` | `"live"` asks a weather service. `"none"` is seasons only. Or force a look. |
| `season` | `"auto"` | Follows the calendar and the hemisphere. |
| `time` | `"auto"` | Follows the real sun when live weather knows it, else the clock. |
| `intensity` | `1` | How hard a *forced* look falls, 0.3 (drizzle) to 1.7 (downpour). Live weather sets its own. |
| `tone` | `"auto"` | `"light"` or `"dark"`. Auto reads the page background and follows theme changes. |
| `hemisphere` | `"auto"` | From the latitude when known, else a guess from the timezone. |
| `location` | `"ask"` | How live weather is located. See below. |
| `askAfter` | `0` | With `"ask"`: ms, or a promise, to wait before the permission prompt. |
| `askOnce` | `true` | Raise the prompt at most once per tab session. |
| `provider` | Open-Meteo | `(lat, lon, signal) => Promise<Conditions>`, to use another service. |
| `interactive` | `true` | Pointer and scroll push the particles. |
| `ignoreClicks` | links, buttons, form controls | Clicks on matching elements don't make a gust. |
| `zIndex` | `50` | The canvas; the fog layer is one below. |
| `quality` | `"auto"` | A fixed density multiplier, or `"auto"` to back off on slow machines. |
| `respectReducedMotion` | `true` | |
| `container` | `document.body` | Where the canvas lives in the DOM. It is always fixed and full-viewport. |
| `nonce` | | CSP nonce for the one `<style>` tag it adds. |
| `onChange` | | Called with the new `SkyState` whenever what's on screen changes. |

`sky.set()` can change `season`, `time`, `weather`, `intensity`, `tone`, `hemisphere`, `location`, `provider`, `zIndex` and `onChange`. The rest are read at mount.

### How the weather is located

`location` decides how, and whether, the visitor is asked.

| `location` | |
| --- | --- |
| `"ask"` (default) | Asks the browser for the visitor's position, once per session. While the prompt is open, and if it's declined, a **city guessed from the timezone** stands in, so there is always weather on screen and nobody waits on a dialog. |
| `"silent"` | Uses the position only if permission was already granted. Never prompts. |
| `"timezone"` | Never touches the geolocation API. |
| `{ lat, lon }` | A fixed place, e.g. your office. No permission involved. |

Hold the prompt back until your intro animation is done:

```ts
mountSky({ askAfter: introFinished }); // a Promise, or a number of ms
```

`sky.requestLocation()` raises it on demand, from a button.

**Privacy.** Coordinates are rounded to one decimal place (about 10 km) before they leave the browser, go only to Open-Meteo, and are never stored or put in state. The timezone fallback sends only a city name from the timezone, the same string for everyone in that zone. Weather answers are cached in `sessionStorage` for ten minutes. You should still say what you do in your own privacy notice.

## The scenes

|            | clear | rain | snow | storm |
| ---------- | ----- | ---- | ---- | ----- |
| **spring** | petals | rain, rainbow by day | snow | rain, petals thrown by the wind |
| **summer** | leaves; fireflies at dusk | sun shower: rain and a rainbow | snow | thunderstorm, leaves thrown |
| **autumn** | maple, oak, ginkgo | rain, faint rainbow | snow | rain, leaves thrown sideways |
| **winter** | snow | sleet (rain if it's mild) | heavy snow | blizzard |

Fog and overcast are layered on top. Rain and snow *replace* the season's particles: leaves drifting down at a stroll beside rain falling twenty times faster just looks wrong. Storms are the one exception, where leaves appear only as debris.

## API

```ts
mountSky(options?): Sky
sky.set(patch)           // change options
sky.getState()           // SkyState | null
sky.requestLocation()    // ask for the exact location now
sky.snapshot()           // live particles, for debugging
sky.destroy()
```

For building on top, the pieces are exported too:

```ts
buildRecipe({ season, phase, weather, tone, intensity?, freezing?, temperatureC?, windKmh? }): Recipe
SkyRenderer               // the canvas engine, if you want your own controller
seasonOf, phaseOf, phaseFromSun, hemisphereFromLatitude, hemisphereFromTimeZone
weatherFromCode, openMeteo, placeFromTimeZone, startLive
detectTone, toneOfColor
```

`buildRecipe` is a pure function returning plain data, so you can test any scene without a browser:

```ts
buildRecipe({ season: "winter", phase: "night", weather: "storm", tone: "dark" });
// → { layers: [flakes ×91], wind: 3.2, haze: { kind: "fog" }, lightning: false, … }
```

## Notes

- It renders nothing on the server (`mountSky()` returns an inert handle), so it's safe in SSR frameworks.
- Fog is a small block of CSS injected once (`#seasonal-sky-styles`); everything else is one `<canvas>`.
- The canvas is `pointer-events: none` and listens on `window`, so the page underneath stays fully clickable.

## Develop

```sh
npm install
npm test            # pure logic: seasons, sun, weather codes, every recipe
npm run build
npm run demo        # serves ./examples at http://localhost:4173/examples/
```

## License

MIT
