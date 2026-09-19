# Project Brain Roadmap

Updated: 2026-09-19

Canonical tracker: GitHub Issue #112.

## Purpose

Project Brain is an exploratory EverywherePoster workstream for **neuroscience-assisted content intelligence**.

The goal is not to build a generic "brain scanner" or claim that EverywherePoster can read an individual viewer's mind. The goal is to investigate whether predicted brain-response signals, combined with ordinary multimodal content analysis and later real behavioral outcomes, can help EverywherePoster answer a practical creator question:

> Which parts of this source content are most worth repurposing and publishing, and why?

This roadmap is research/prototype work. It is not a current launch blocker, not a current product promise, and not authorization for production integration.

## Product fit

EverywherePoster is source-content-first: create once, adapt by platform, publish everywhere.

Project Brain extends that direction from **repurposing and distribution** toward **content intelligence**:

1. understand the source content;
2. identify potentially strong moments;
3. estimate useful response/attention-related signals;
4. generate or select derived content;
5. let the human approve;
6. publish;
7. compare predictions with real outcomes;
8. learn which signals actually matter.

The long-term opportunity is the closed loop, not a brain visualization by itself.

## Working hypothesis

A useful content-ranking system may be built from several signal families:

- predicted brain-response / cortical-response features;
- visual quality and visual salience;
- audio quality, intensity, pacing, and change;
- transcript semantics, hooks, novelty, and information density;
- content importance / summarization signals;
- face, scene, object, and motion features where useful;
- creator selections and rejections;
- actual post/video performance where available and permitted.

No single signal should be treated as ground truth.

## What the first prototype must prove

The first checkpoint is intentionally narrow.

### Input

One short real video relevant to EverywherePoster.

### Process

Use an existing pretrained brain-response/video model rather than training a foundation model.

The initial candidate is MIRAGE or another openly usable model with an appropriate license and reproducible inference path. Model choice must be reverified at implementation time.

### Output

Produce:

- a reproducible predicted response output;
- a time-aligned visualization or timeline;
- a way to map peaks/changes back to exact video timestamps;
- recorded runtime and hardware behavior;
- model provenance and license notes;
- scientific limitations and failure modes.

### First-checkpoint success criterion

A real input video produces a reproducible, time-aligned predicted response that can be inspected alongside the source video.

That is enough to decide whether to continue. It is **not** evidence that the system predicts virality, dopamine, entertainment, retention, or sales.

## Current local hardware

Development machine:

- 32 GB system RAM;
- NVIDIA RTX 3060;
- Intel i5-9600K.

Use local hardware for proof-of-concept inference and small downstream experiments when feasible.

Do not purchase new hardware for Project Brain before the proof of concept demonstrates value. If a justified experiment needs more VRAM/compute, rented GPU capacity is acceptable.

## Research directions

### Brain-response encoding

Investigate models that map video/audio/text into predicted fMRI or cortical-response signals.

Candidate examples discussed during discovery include MIRAGE and related multimodal encoding work. Treat all model availability, weights, licenses, VRAM requirements, and commercial-use terms as facts to reverify before implementation.

### Public data

Potential public data families include:

- movie/video fMRI datasets;
- video summarization / highlight-importance datasets;
- user-generated-video quality datasets;
- social-video quality datasets;
- large-scale video representation datasets.

Commercial-use and derivative-training rights must be checked dataset by dataset. Do not assume that "public" means production/commercial use is permitted.

### Downstream ranking model

If raw brain-response predictions are technically viable, train a much smaller EverywherePoster-specific model on top of extracted features rather than attempting to train a large video foundation model from scratch.

Potential target:

```text
source video
  -> multimodal encoder(s)
  -> brain-response / visual / audio / transcript features
  -> EverywherePoster ranking model
  -> timestamp-level scores + explanations
```

The local RTX 3060 is much more suited to this kind of downstream model than to training a modern large multimodal foundation model from scratch.

## Guardrails

### Scientific claims

Do not claim or imply that:

- EverywherePoster reads an individual user's brain;
- a predicted fMRI response proves a viewer's emotion or mental state;
- "more total brain activation" means better content;
- a raw activation pattern is dopamine;
- a model output is automatically engagement, entertainment, memory, virality, retention, revenue, or persuasion.

Avoid reverse-inference errors: one brain region or predicted response pattern can participate in many cognitive processes.

Any user-facing interpretation layer must be separately validated.

### Product claims

Do not promise guaranteed:

- virality;
- engagement;
- reach;
- retention;
- conversions;
- follower growth;
- revenue.

Project Brain does not change the durable source-content-first product promise unless a later explicit product decision updates PRODUCT_TRUTH.md.

### Licensing

Before using any model, weights, training data, or benchmark data beyond research:

- verify the current license;
- verify commercial-use rights;
- verify attribution/share-alike obligations;
- verify whether trained derivatives can be distributed or used commercially;
- record the source and decision.

Do not build a production dependency around noncommercial-only assets without an explicit replacement path.

### Privacy

If Project Brain later uses real EverywherePoster customer content, user selections, or post-performance outcomes:

- define what is collected;
- define the lawful/product basis for collection;
- minimize retention;
- separate model-training consent from ordinary product operation where appropriate;
- avoid storing unnecessary raw media;
- document deletion behavior;
- keep user/account data boundaries intact.

No production data or secrets are authorized by this roadmap.

## Phases

### B0 — Repository grounding — COMPLETE

- Canonical roadmap exists.
- GitHub tracker exists.
- Workstream is explicitly non-blocking for launch.
- Product/scientific guardrails are recorded.

### B1 — One-video brain-response proof of concept — NEXT

Goal: see the idea work before building product infrastructure.

Acceptance:

- run an appropriate pretrained model against one short video;
- save the raw prediction;
- render a useful visualization;
- map predictions to source-video time;
- document exact environment and repeatable commands;
- record RTX 3060 behavior, runtime, and memory constraints;
- record model/weights license;
- list scientific limitations observed.

Non-goals:

- no EverywherePoster production integration;
- no training a large model;
- no engagement score;
- no automated publishing;
- no architecture rewrite.

Decision after B1:

- stop if the model cannot produce a usable/reproducible signal;
- continue to B2 only if the output is technically real and inspectable.

### B2 — Interpretation layer

Goal: determine whether raw predicted response can be translated into understandable, defensible content-analysis signals.

Investigate:

- broad functional/network groupings;
- time-local changes and peaks;
- visual vs auditory vs language-related contributions where supported;
- confidence/uncertainty;
- stable explanations that avoid pretending to infer unobserved mental states.

Acceptance:

- every displayed label has a documented basis;
- uncertain interpretation is labeled as uncertain;
- no unsupported "dopamine/virality/engagement" conversion.

### B3 — Multisignal moment ranking

Goal: rank potentially useful source moments rather than merely visualize brain response.

Combine, where useful:

- predicted response features;
- transcript semantics;
- visual quality;
- motion/scene changes;
- audio;
- novelty;
- pacing;
- content-importance features.

Output example:

```text
00:06-00:21  high-priority candidate
01:42-01:58  high-priority candidate
03:11-03:27  medium-priority candidate
```

Do not use a fake 0-100 "brain engagement" score merely for presentation.

### B4 — Research UI inside EverywherePoster

Goal: make the analysis inspectable in product without making it an automatic publishing authority.

Possible UI:

- source-video timeline;
- candidate moments;
- signal overlays;
- reason/explanation per candidate;
- user accept/reject;
- optional creation of downstream text/image/carousel/video-adaptation tasks.

Human approval remains required before publishing.

### B5 — Validation

Goal: determine whether the ranking is actually useful.

Preferred validation progression:

1. blinded human preference;
2. creator selection/rejection behavior;
3. controlled comparison against simpler baselines;
4. real post/video outcomes where lawful, available, and sufficiently comparable.

Always compare against simpler baselines such as:

- random moment selection;
- transcript-only ranking;
- generic multimodal ranking;
- human-selected moments.

Project Brain only earns complexity if it adds measurable value beyond simpler methods.

### B6 — Proprietary learning loop

If validation succeeds and privacy/product requirements are satisfied, investigate learning from:

- which candidates users accept;
- which candidates users reject;
- manual changes to selected timestamps;
- chosen thumbnail/frame;
- content format selected;
- platform destination;
- real performance outcomes.

Potential long-term loop:

```text
predicted response
+ multimodal content features
+ creator preference
+ platform/context
+ historical outcomes
-> EverywherePoster ranking model
```

This resulting dataset/model could become more differentiated than the original public brain-response model.

### B7 — Production decision

Before calling Project Brain a production pillar, answer:

- Does it outperform simpler ranking methods?
- Does it improve a creator-relevant outcome?
- Is inference cost acceptable for EverywherePoster's business model?
- Are latency and reliability acceptable?
- Are model/data licenses compatible with commercial use?
- Are privacy/consent/retention rules acceptable?
- Can user-facing claims be scientifically defended?
- Does it fit product positioning without distracting from repurposing/distribution?
- Is the system maintainable if an upstream research model disappears?

Only then should architecture, pricing implications, or public positioning change.

## Candidate product experience

Long-term concept, not current capability:

```text
Upload source content
        |
        v
Multimodal analysis
        |
        +--> transcript / semantics
        +--> visual / motion
        +--> audio
        +--> predicted brain-response features
        |
        v
Moment ranking
        |
        v
Suggested clips / images / carousels / text posts
        |
        v
Human review
        |
        v
Publish across connected accounts
        |
        v
Actual outcomes
        |
        v
Learning loop
```

## Competitive framing

The research premise is that several adjacent categories already exist:

- social publishing/scheduling;
- source-content repurposing;
- AI clip/highlight selection;
- creative pretesting / attention prediction;
- neuroscience/brain-response research tools.

Do not claim that EverywherePoster has no competitors.

The potentially differentiated direction is the combination of:

**source content -> content intelligence -> multimodal repurposing -> human review -> multi-platform publishing -> outcome learning**.

Competitive claims must be reverified when product positioning is written.

## Relationship to current EverywherePoster priorities

Project Brain is not allowed to silently displace the current launch objective.

Priority order remains governed by `docs/brain/CURRENT_WORK.md`.

Project Brain work can proceed when:

- it is explicitly selected by the user; or
- current launch work is externally blocked and Project Brain is an appropriate bounded parallel research task.

Do not make provider verification, billing, publishing reliability, or launch readiness wait for Project Brain.

## First implementation task

Create a reproducible B1 proof-of-concept outside the production app.

Suggested shape:

1. WSL/Ubuntu environment;
2. verify NVIDIA/CUDA visibility;
3. clone/pin the selected research implementation;
4. create isolated Python environment;
5. install pinned dependencies;
6. run the upstream demo;
7. run one user-supplied test video;
8. save raw predictions and visualization artifacts;
9. document exact commands, versions, runtime, VRAM behavior, and limitations;
10. decide continue/stop before any product integration.

No Codex dependency is required for this proof. It can be executed manually with terminal commands.

## Update rule

Update this roadmap when a Project Brain phase changes state, a candidate model/dataset is accepted or rejected for a durable reason, validation changes the product hypothesis, or a production decision is made.

Do not turn it into a raw experiment log. Put reproducibility instructions/results in a focused experiment document or issue comment and keep this file as the durable roadmap.
