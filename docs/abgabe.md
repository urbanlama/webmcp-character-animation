# Character animation in the browser — Submission Text

## 1. Why does this fit WebMCP?

LLM agents cannot animate rigged 3D characters. Elbows end up inside heads, feet float
above the floor, and a standing figure produces hundreds of false physics alarms. This
is not a model-capability problem — it is a blindness problem. Desktop 3D tools are
built for human eyes: every action ends in a rendered image, and in that image you
cannot see that a foot penetrates the floor by 18 mm or that the center of mass has
left the support area.

WebMCP removes the blindness, and our measurements prove the transport layer is
sufficient for the job. In Chrome 151, tool responses of up to 512 KB arrive complete
in 5 ms, so measurement reports do not have to be trimmed. Registration at runtime
works: we went from 5 to 45 registered tools live, all visible and callable via
`getTools()`. This matters architecturally — the tool set can be created *after* the
user uploads a model, so tools describing the measured body cannot exist earlier.
Images in tool responses work and are actually understood: in a controlled test,
two different images containing random words (never present in the accompanying text)
were correctly read back as SEEIGEL and NUDELHOLZ — the text-and-image combination in
one response is where we deliver measurement numbers and visual evidence together.

The deeper match is structural. A measuring layer, a phase solver and a validator
would work identically inside a classic MCP server. What **only** WebMCP can provide
is a shared, visible situation: a server process has no interface and nobody sitting
in front of it. Our page keeps the human and the agent in the same running document,
which is what makes the human-in-the-loop design in section 3 possible at all.

## 2. How does it improve the user experience?

Today, asking an agent to animate a character fails in a characteristic way. In a
pre-test with raw keyframe tools plus measurement feedback, a 20-minute run produced a
rotation with no takeoff, one third of the timeline completely motionless, and not a
single rendered image — the agent never looked at its own work. The user then spends
their time spotting "elbow in face" errors that the agent cannot see.

This project turns that around, with three concrete improvements:

- **No rig setup.** The page measures the uploaded model itself — body height, segment
  radii and masses, sole points, joint axes and signs, resting distances. The user
  never assigns bones manually.
- **No invisible failures.** After every step the agent receives numbers *and* an
  annotated image strip (measured in meters relative to body height), always together
  in one response — this pairing is enabled by the verified `type: 'image'` support.
- **Taste goes to the human, correctly.** A tool can block until the user clicks and
  return the answer within the same tool call (measured: 3.1 s wait). The user gets a
  two-variant choice, in everyday language, answered with one click — not a
  free-text negotiation with the agent.

The result for the user is that a phrase like "backflip from a standing start" produces
an animation where the physics actually holds, instead of a silent failure they must
detect frame by frame.

## 3. What can human and agent now do together that was not possible before?

The core answer: the agent pauses mid-work, shows the human two variants side by side,
waits for a click, and continues building with that answer. Three fixed interaction
points make this concrete:

1. **After upload** — the page asks the human to confirm uncertain bone-role
   assignments (confidence between 0.5 and 0.9; below 0.5 the chain stays unassigned
   rather than guessed) and ambiguous facing direction. The questionable bone lights up
   in the viewport; the answer is a click.
2. **Before building** — the agent states its intent as measurable success criteria
   (rotation in degrees, flight time, displacement in body heights). The human
   confirms in five seconds what a mis-build would have cost twenty minutes, which is
   exactly what the pre-test in section 2 measured.
3. **On taste questions** — two variants rendered side by side, one click, answer
   returned inside the same tool call.

None of this needs the human to write prompts like "now fix the left knee in frame 34".
And none of it is possible for a classic MCP server: `ask_human` as a blocking tool
call returning on click was verified working in WebMCP (3.1 s measured wait), while a
server process has no surface to click on. Additionally, the page can invoke its own
tools via `executeTool` — 50 chained calls in 16 ms — so the human gets reproducible
regression runs of exactly the tool sequence the agent used.

## 4. How is it implemented?

A web page that loads any rigged humanoid GLB, measures it, and exposes a fixed
catalog of 16 MCP tools (via `document.modelContext.registerTool`) covering three
action levels: motion phases, end-effector targets, and single joint angles.

- **Measuring, not guessing.** Body dimensions come from the loaded model: radii from
  vertex distances to the segment axis (90th percentile), masses from capsule volume,
  sole points from ground proximity in bind pose, contact thresholds from sole height.
  The measured-vs-estimated comparison is the strongest number in the project:
  estimated radii, masses and contact points produced **269 false alarms on a clip
  where the figure stands still**; after switching to measurement, ground penetration
  and balance errors disappeared completely. Joint axes are verified by sampling
  (+20°, measuring the effect at the chain end), which surfaced and fixed three real
  sign errors; twist axes that resist this method are declared `nicht_messbar` instead
  of guessed.
- **Phases, not keyframes.** The agent orders motion as one of ten fixed verbs
  (`stand`, `crouch`, `takeoff`, `land`, …). A center-of-mass-driven solver turns
  parameters into poses: anchored limbs via inverse kinematics, joint limits as hard
  constraints, and — in flight — angular velocity adjusted per frame from the segment
  masses so angular momentum stays constant during tucks. Where the solver must
  sacrifice a soft condition to a hard one, the report states the amount
  ("center-of-mass path missed by 6 cm").
- **Three validation layers, phase-dependent.** Physics always: ground penetration,
  self-penetration (checked against bind-pose resting distances, after calibration on
  all five reference clips produced 0 false alarms — but calibration learned on two
  clips transferred to none of the other three, yielding 150, 132 and 183 alarms, so
  learned pair distances were rejected in favor of per-model measurement), joint
  limits, foot sliding, balance only with ground contact, ballistics only airborne.
  Intent: the human-confirmed success criteria. Style: motion density, anticipation,
  jerk. Every report ships with an annotated image strip automatically — the measured
  antidote to the agent that never looked at its work.
- **Export.** glTF with root motion, verified by independent re-import and comparison
  of joint trajectories and events.

## Not finished at the time of writing

Written from `README.md`, `VISION.md`, `docs/plan.md` and the spike results; the
Leitung should verify each point below before submitting:

- The behavior of a **real browser agent** (ChatGPT browser) with the 16-tool catalog
  is untested — all WebMCP measurements were taken via `executeTool` through the
  debug interface, because the ChatGPT browser is not installed on the build machine
  (`spikes/test-a-webmcp/ERGEBNIS.md`, "Offen" section).
- The demo video (<3 min, public YouTube, with sound) and the live URL are separate
  submission requirements not covered by this text; their status is the Leitung's to
  confirm.
- Per `docs/plan.md` section 9, still open: whether foot sliding is correctly reported
  in clips without root motion, and the procurement of at least three acceptance
  models under a free license.
- The backflip itself ("Press play and it looks right", `VISION.md`) is the project's
  stated largest remaining risk; if a simpler motion (jump with landing) is the final
  demo, section 2's example must be updated accordingly.