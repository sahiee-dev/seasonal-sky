# Changelog

## 0.1.0

First release, extracted from a portfolio site.

- Canvas particle sky: maple, oak and ginkgo leaves, summer leaves, petals,
  snow, rain, sleet, fireflies, fog and overcast, lightning, rainbows.
- Season × time of day × weather are composed, not looked up: rain and snow
  replace the season's particles, storms throw them as debris, a blizzard is
  not a storm with snow in it.
- One shared wind. Pointer pushes, click makes a shockwave, rain has an
  umbrella around the cursor, fireflies are curious, scroll nudges.
- Live weather from Open-Meteo, no key. Asks for location once a session, with
  a timezone-city estimate on screen meanwhile and kept if declined.
- Real sunrise and sunset drive dawn and dusk; the temperature decides rain
  versus sleet; WMO codes give drizzle and downpour their own intensity.
- Southern hemisphere seasons.
- Page tone (light or dark) is read from the page and follows theme changes.
- Layers cross-fade when the sky changes; particle count steps down on slow
  machines; nothing is drawn under `prefers-reduced-motion`.
- React bindings at `seasonal-sky/react`.
