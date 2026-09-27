# The brief

This is the brief Ocean Drive was built from, unedited. The list after it says where the scene
ended up going beyond it.

---

build ocean drive in miami beach at sunrise golden hour, walkable in first person in the browser with three.js.

the scene: one block of the street. pastel art deco hotels in pink, mint, lemon and lavender, with rounded corners, eyebrow ledges and porthole windows. the sun is just above the atlantic, lighting the hotel fronts warm gold. palm trees along the sidewalk throw long shadows across the road. a convertible parked at the curb. across the street: the park, white sand, a colorful lifeguard tower, and a turquoise ocean with the sun sparkling on the water. light haze in the air. it must look like real travel photography, not a game.

the walk: WASD and mouse look. walk the sidewalk past the hotels, cross the street, walk onto the sand, climb the lifeguard tower steps, and walk down to the water, where the waves wash in around you. footsteps change between pavement, sand and wet sand.

sound: synthesize everything in code. waves, seagulls, wind in the palm fronds, a car passing slowly, soft music drifting from a hotel patio, footsteps on each surface.

skills: before writing any code, use github.com/cloudai-x/threejs-skills, github.com/dgreenheck/webgpu-claude-skill, github.com/majidmanzarpour/threejs-game-skills, and /find-skills threejs AAA game

/loop  the gauntlet below until the full scene passes:
1. pick the next unfinished system, in this order: sky and lighting, hotels, palms, street and car, beach and ocean, sound, walking. once all are done, the full scene together is the last system.
2. builder agent builds or fixes that system.
3. critic agent, a separate agent that has never read the code, takes screenshots from 5 fixed camera positions and compares them side by side against real sunrise photos of ocean drive and miami beach. it lists every specific thing that looks fake: wrong colors, flat materials, bad shadows, scale, repetition, missing detail. no "looks good" judgments, only comparisons to the real photos.
4. if the critic lists anything, the builder fixes it and the critic checks again. when the critic finds nothing it can point to that looks fake, mark that system done and move to the next one.
stop when the full scene passes.

rules:
- nothing downloaded: no models, textures, images or audio files. everything generated in code.
- no real hotel names, brand names or logos. make up the signs.
- nothing that references any video game.
- sequential agents only, never parallel. don't max out my CPU or GPU (RTX 4060). run test screenshots on my second screen.
- deploy to GitHub Pages and give me the live link.

i'm not gaming rn btw

---

## What changed along the way

The brief was the starting point, not the fence. The day after the overnight build, at the user's
request, the scope grew past it:

- **More than one block.** The brief asked for one block of the street. The district now runs
  680 m, from z −340 to +340, across six cross streets, with about forty hotels and a far level
  of detail beyond them.
- **People.** A jogger, a beach walker on the wet sand, a café worker and a cyclist, all casting
  the same long sunrise shadows as the palms.
- **Birds.** Lines of pelicans low over the water, gulls that flee when you walk at them,
  sanderlings chasing the swash, grackles on the patios, a frigatebird and cormorants.
- **Things to ride.** A beach cruiser and a lifeguard ATV, both with their own engine or
  freewheel sound. E gets on and off.
- **Phones and laptops.** Quality tiers, dynamic resolution and touch controls. The brief only
  asked for WASD and mouse look.
- **A loader.** A sunrise title card whose progress bar reports the real build stages.
- **Three lifeguard towers** instead of one, all climbable.
