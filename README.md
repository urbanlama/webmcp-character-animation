# Character Animation for Agents

A web page where an AI agent animates a rigged 3D character.

Entry for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com).

- **Try it live:** https://urbanlama.github.io/webmcp-character-animation/
- **Code:** https://github.com/urbanlama/webmcp-character-animation (MIT)

## The problem

Ask an AI agent to animate a rigged character today, through a Blender connection or
straight in a 3D scene in the browser, and you get a figure that reaches through
itself, sticks in the floor, or barely moves at all.

That is not because the AI is too stupid for it. It has too little to work with. It
does not know how tall the figure is, where its weight sits, or how far a knee bends.
And it never finds out what its last move actually did.

## The approach

A page that gives the agent what it was missing.

**It measures the model itself.** Body height, mass distribution, sole points, joint
axes and facing direction are measured from the loaded model. No manual bone mapping,
no assumptions baked into the code.

**The agent animates by hand.** It sets poses and single joint angles, frame by frame.
Nothing comes out of a motion library, so the movement that comes out did not exist
before.

**Every call answers with numbers.** How far a foot sits inside the floor, in
centimetres. Which foot slides in which frame. Where the balance tips. Where the
solver had to miss what the agent asked for, and by how much.

**It can look.** The agent can request a rendered image strip from several angles when
numbers alone are not enough.

## Code map

| Directory | What lives there |
|---|---|
| `src/rig/` | Measuring the loaded model |
| `src/solver/` | The solvers: keyframes, foot anchors, ballistic arcs |
| `src/validate/` | Physics, intent and style checks |
| `src/tools/` | The WebMCP tool layer (20 registered tools) |
| `src/render/` | The image strip for the agent |
| `src/ui/` | The interface, the agent trace |

Measured on the test figure Xbot: 1.8093 m tall, 67 bones, 15 segments, 8 sole points.
None of these numbers is typed into the code.

## A note on language

> Source code comments are in German. They are not decoration — each one cites the
> measurement that caused the decision. This README is the English entry point.

## Trying it out

- In the ChatGPT in-app browser, or
- in Chrome with `chrome://flags/#enable-webmcp-testing` enabled.

Open https://urbanlama.github.io/webmcp-character-animation/ and let the agent
drive the page.

## License

MIT, see [LICENSE](LICENSE).
