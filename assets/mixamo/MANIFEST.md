# Mixamo assets — Ocean Drive, Miami Beach at sunrise

Source: [Mixamo](https://www.mixamo.com) (Adobe), downloaded with the project owner's account.
Licence: royalty-free for use inside this project; the raw `.fbx` files must **not** be redistributed standalone, which is why `assets/mixamo/**/*.fbx` is git-ignored. This manifest is tracked so the set can be re-downloaded.

All files: FBX Binary (`fbx7_2019`). Every character uses the standard Mixamo skeleton (`mixamorig:*` bones), so any animation below can be retargeted onto any character by bone name.

## Characters (with skin, T-pose)

| File | Character | Mixamo id | Gender | Size | Description |
|---|---|---|---|---|---|
| `sophie/sophie_tpose.fbx` | Sophie | `61bcdb20-7b85-4f2e-a109-2a0fbd54af78` | F | 47.7 MB | Young woman, light skin, blonde hair in bun; mustard sweatshirt, denim cut-off shorts, yellow sneakers. Slim build. |
| `elizabeth/elizabeth_tpose.fbx` | Elizabeth | `5a0e290c-92ea-42e4-afea-cb94ba3fab6d` | F | 53.6 MB | Young Black woman, curly natural hair; striped long-sleeve top, rolled-up jeans, red flats. Average build. |
| `megan/megan_tpose.fbx` | Megan | `37f11292-3002-46c3-ac53-f773d1a93026` | F | 56.6 MB | Woman in her 20s-30s, medium/olive skin, dark hair tied back; white t-shirt, blue jeans, sneakers. Slim build. |
| `remy/remy_tpose.fbx` | Remy | `037852b5-74da-44aa-878b-eccda13e5139` | M | 27.0 MB | Middle-aged man, light skin, short blond/grey hair; dark grey v-neck t-shirt, khaki cargo shorts, white sneakers. Average build. |
| `bryce/bryce_tpose.fbx` | Bryce | `e90a6228-9937-4a24-83f7-886adcfb0a0a` | M | 51.5 MB | Young man, light/tan skin, shaggy dark hair, arm tattoos; red graphic t-shirt, denim shorts, white sneakers. Slim-athletic build. |
| `lewis/lewis_tpose.fbx` | Lewis | `bb7d74a1-ffe3-4fb5-b6b5-48c5fecc9b4e` | M | 43.2 MB | Young Black man, short hair; teal short-sleeve shirt, dark trousers, dark shoes. Tall, slim build. |

## Animations (without skin, 30 fps, no keyframe reduction)

Downloaded once on a reference character: **Bryce** for male clips and **Sophie** for female clips. Locomotion is exported *in place*, so root motion has to be driven by code. "In place" is "n/a" when Mixamo offers no in-place option for that clip.

| File | Product name | Variant (Mixamo description) | Product id | Ref char | In place | Duration | Intended use |
|---|---|---|---|---|---|---|---|
| `animations/car_enter.fbx` | Entering Car | Entering Into The Driverside Of A Car | `c9cce376-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 5.43s | Entering driver side of car (737 KB) |
| `animations/car_exit.fbx` | Exiting Car | Exiting Out Of The Driverside Of A Car | `c9cd08db-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 5.80s | Exiting driver side of car (765 KB) |
| `animations/drive_car.fbx` | Driving | Male Driving A Car | `c9c64f3c-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 2.97s | Seated driving, hands on wheel (567 KB) |
| `animations/drive_honk.fbx` | Honking Horn | Hitting Steering Wheel In Driving Idle | `c9c96391-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 3.33s | Driving idle, hitting horn (579 KB) |
| `animations/idle_breathing.fbx` | Breathing Idle | Breathing Idle | `c9c6d0d5-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 8.67s | Breathing idle (1.1 MB) |
| `animations/idle_happy.fbx` | Happy Idle | Happy Idle Variation 1 | `c9ccf37e-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 1.97s | Happy idle (477 KB) |
| `animations/idle_looking_around.fbx` | Looking Around | Idle Stand Looking Around | `c9c6cdf7-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 5.07s | Idle looking around (809 KB) |
| `animations/idle_looking_around_2.fbx` | Unarmed Idle Looking Ver. 1 | Looking Around | `c9ceeaca-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 11.23s | Idle looking around (variation) (1.1 MB) |
| `animations/idle_phone_talk_f.fbx` | Talking On Phone | Female Standing Talking On Phone | `c9c9f63d-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 38.83s | Standing talking on phone (female) (3.2 MB) |
| `animations/idle_phone_talk_m.fbx` | Talking On A Cell Phone | Male Standing While Talking On A Cell Phone | `c9ca0104-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 37.23s | Standing talking on phone (male) (2.8 MB) |
| `animations/idle_standing.fbx` | Idle | Standing Idle | `c9c972d1-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 8.33s | Standing idle (770 KB) |
| `animations/idle_stretch_arms.fbx` | Arm Stretching | Stretching Arms By Pushing The Elbows | `c9c90cbb-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 8.87s | Arm stretching (1001 KB) |
| `animations/idle_stretch_neck.fbx` | Neck Stretching | Stretching Neck Rolling Side To Side | `c9c9113b-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 3.17s | Neck stretching (610 KB) |
| `animations/idle_weight_shift_f.fbx` | Idle | Weight Shift Idle | `c9c79c65-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 14.17s | Weight-shift idle (1.6 MB) |
| `animations/jog.fbx` | Jogging | Jogging | `c9c8707d-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 2.53s | Jogging loop (joggers on the promenade) (535 KB) |
| `animations/jog_slow.fbx` | Slow Jog | Jogging Slowly Varying Angles Of Twist | `c9c6b97b-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 0.80s | Slow jog loop (343 KB) |
| `animations/run_f.fbx` | Run Forward | Female Run Forward | `c9ccfb22-b96c-11e4-a802-0aaa78deedf9` | sophie | yes | 0.57s | Female run forward loop (303 KB) |
| `animations/run_slow.fbx` | Slow Run | Slow Run Forward | `c9ce777f-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 0.70s | Slow run loop (337 KB) |
| `animations/sit_drinking.fbx` | Sitting Drinking | Having A Seat And Drinking A Canned Beverage | `c9cb9a91-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 15.20s | Sitting and drinking a can (1.4 MB) |
| `animations/sit_fidget_feet.fbx` | Sitting | Sit With Fidgeting Feet | `c9c699a5-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 1.13s | Sitting with fidgeting feet (348 KB) |
| `animations/sit_idle.fbx` | Sitting Idle | Sitting With Breathing Idle | `c9ccab1b-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 4.27s | Sitting idle with breathing (bench) (521 KB) |
| `animations/sit_idle_f.fbx` | Sitting Idle | Sitting With Breathing Idle | `c9ccab1b-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 4.27s | Sitting idle with breathing (bench, female) (521 KB) |
| `animations/sit_looking_around.fbx` | Sitting | Sitting Looking Side To Side | `c9c698e8-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 3.97s | Sitting looking side to side (568 KB) |
| `animations/sit_talking.fbx` | Sitting Talking | Sitting And Talking To Another Person | `c9cd76b1-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 44.03s | Sitting talking to another person (3.7 MB) |
| `animations/sit_talking_2.fbx` | Sitting Talking | Sitting And Talking To Another Person | `c9cd7793-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 44.97s | Sitting talking (variation) (3.6 MB) |
| `animations/turn_left_standing.fbx` | Left Turn | Standing Left Turn | `c9c9794e-b96c-11e4-a802-0aaa78deedf9` | bryce | n/a (not offered) | 0.93s | Standing turn left in place (358 KB) |
| `animations/turn_right_f.fbx` | Right Turn | Female Turning Right In Place | `c9cd0074-b96c-11e4-a802-0aaa78deedf9` | sophie | n/a (not offered) | 1.07s | Female turning right in place (341 KB) |
| `animations/turn_right_standing.fbx` | Right Turn | Standing Right Turn | `c9c97a12-b96c-11e4-a802-0aaa78deedf9` | bryce | n/a (not offered) | 0.93s | Standing turn right in place (357 KB) |
| `animations/walk_briefcase_f.fbx` | Walk W/ Briefcase | Female Walk With Briefcase | `c9c9eb1a-b96c-11e4-a802-0aaa78deedf9` | sophie | yes | 1.07s | Walking holding a bag/briefcase (female) (340 KB) |
| `animations/walk_casual_f.fbx` | Female Walk | Female Normal Walk | `c9c68b91-b96c-11e4-a802-0aaa78deedf9` | sophie | yes | 1.13s | Casual walk loop (female pedestrians) (348 KB) |
| `animations/walk_casual_m.fbx` | Standard Walk | Standard Walk | `c9ccc2e9-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 1.17s | Casual walk loop (male pedestrians) (383 KB) |
| `animations/walk_feminine_f.fbx` | Walking | Feminine Walk Forward | `c9c987f5-b96c-11e4-a802-0aaa78deedf9` | sophie | yes | 0.97s | Alternative relaxed female walk loop (363 KB) |
| `animations/walk_happy_m.fbx` | Walking | Male Happy Walk | `c9c609a9-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 1.37s | Upbeat/breezy male walk loop (409 KB) |
| `animations/walk_holding_object.fbx` | Holding Walk | Holding An Object While Walking | `c9cda1e7-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 1.37s | Walking holding an object (coffee, bag) in front (404 KB) |
| `animations/walk_phonecall_f.fbx` | Pacing And Talking On A Phone | Female Answers A Phone While Walking | `c9ca0326-b96c-11e4-a802-0aaa78deedf9` | sophie | n/a (not offered) | 37.63s | Answering phone while walking (female) (2.6 MB) |
| `animations/walk_shopping_bag_m.fbx` | Walking With Shopping Bag | Male Walking With Shopping Bag | `c9c64027-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 1.23s | Walking with shopping bag in hand (372 KB) |
| `animations/walk_start_f.fbx` | Female Start Walking | Female Start Walking | `c9c68c4c-b96c-11e4-a802-0aaa78deedf9` | sophie | n/a (not offered) | 1.87s | Female idle to walk (404 KB) |
| `animations/walk_start_m.fbx` | Start Walking | Walking From Standing | `c9c8b661-b96c-11e4-a802-0aaa78deedf9` | bryce | n/a (not offered) | 2.90s | Idle to walk (550 KB) |
| `animations/walk_stop_f.fbx` | Female Stop Walking | Female Stop Walking | `c9c68d24-b96c-11e4-a802-0aaa78deedf9` | sophie | n/a (not offered) | 1.53s | Female walk to stop (377 KB) |
| `animations/walk_stop_m.fbx` | Stop Walking | Walking To Standing Idle | `c9c8d966-b96c-11e4-a802-0aaa78deedf9` | bryce | n/a (not offered) | 3.00s | Walk to standing idle (556 KB) |
| `animations/walk_stroll_old.fbx` | Old Man Walk | Slow Old Man Shuffle Walk | `c9c6c0c2-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 1.23s | Slow shuffle stroll (elderly / very slow pedestrians) (356 KB) |
| `animations/walk_texting_f.fbx` | Texting And Walking | Female Walking And Texting On Phone | `c9c9f90e-b96c-11e4-a802-0aaa78deedf9` | sophie | yes | 3.30s | Walking while texting (female) (569 KB) |
| `animations/walk_texting_m.fbx` | Walking While Texting | Male Walking While Texting On A Smartphone | `c9c9fd95-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 4.00s | Walking while looking at phone (male) (598 KB) |
| `animations/walk_turn_180.fbx` | Walking Turn 180 | Turning 180 Degrees While Walking | `c9c9c73f-b96c-11e4-a802-0aaa78deedf9` | bryce | n/a (not offered) | 1.00s | Turn 180 while walking (356 KB) |
| `animations/walk_turn_left.fbx` | Walking Left Turn | Turning Left While Walking | `c9ccc3a9-b96c-11e4-a802-0aaa78deedf9` | bryce | yes | 1.17s | Turn left while walking (386 KB) |
| `animations/wave.fbx` | Waving | Waving | `c9c5ed32-b96c-11e4-a802-0aaa78deedf9` | bryce | no (stationary clip) | 0.53s | Waving greeting (298 KB) |
| `animations/wave_both_hands_f.fbx` | Waving | Waving With Both Hands | `c9c8ee63-b96c-11e4-a802-0aaa78deedf9` | sophie | no (stationary clip) | 3.17s | Waving with both hands (573 KB) |

## Notes

- **Roller / ice skating:** Mixamo has no roller-skating or ice-skating clips. Searches for "skating", "roller", "skate", "ice" and "glide" return only *Skateboarding* (kick push / idle), which was excluded as requested. For skaters, consider blending `walk_casual_*` with a smooth procedural glide, or source a skating clip elsewhere.
- Bench sitting clips are chair/bench height; align the hips to the seat surface in code.
- `drive_car` / `drive_honk` are seated with the hands on a steering wheel at chest height.
