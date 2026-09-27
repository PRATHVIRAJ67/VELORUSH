# Assets

Velo Rush ships with **no external art or audio files**. Everything is generated at runtime:

| Asset | Where it is generated |
| --- | --- |
| Terrain, mountains, lake, gorge | `client/src/world/Terrain.js` (noise heightfield shaped around the track) |
| Road surfaces (asphalt, cobbles, gravel + normal maps), signs, banners, jerseys | `client/src/world/textures.js` (canvas textures) |
| Trees, rocks, bushes, grass | `client/src/world/Vegetation.js` (instanced low-poly meshes) |
| Buildings, tunnel, bridge, spectators, barriers | `client/src/world/Props.js` |
| Cyclist + bicycles | `client/src/entities/CyclistModel.js` |
| Sound effects, ambience, music | `client/src/audio/AudioEngine.js`, `client/src/audio/Music.js` (WebAudio synthesis) |

To use real assets later, drop glTF models, textures or audio files in this folder, serve them from
`client/public/` and swap the procedural builders for loaders (for example, `GLTFLoader` in `CyclistModel.js`).
