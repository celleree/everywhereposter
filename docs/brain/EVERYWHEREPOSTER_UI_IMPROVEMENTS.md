# EVERYWHEREPOSTER RAW UI IMPROVEMENTS — CANONICAL REFERENCE

This is the authoritative condensed version of the raw UI review.

Implement the entire batch and verify it thoroughly. Do not skip testing because it is slow or extensive. Later decisions in this document override earlier brainstorming when the raw review changed direction.

Do not redesign unrelated functionality. Behaviors explicitly marked **KEEP** should remain intact.

## 1. Upload — First Page / Media Library Picker

### Remove unnecessary page movement
- The initial Upload page can currently move/scroll slightly up and down even though its content does not require scrolling.
- Eliminate that unnecessary layout/page scrolling.
- The issue is the app content moving when there is no overflow; do not break normal native browser/OS behavior such as pull-to-refresh merely to solve it.

### Lock and condense the Media Library
- The Media Library can currently move freely up/down and left/right. It should not.
- Lock the Media Library layout into the available viewport.
- Use more of the available screen instead of leaving large amounts of empty space at the top.
- Remove the `Posted Media` tab from this Upload-page media picker.
- Remove the redundant `Media Library` tab/button from this picker.
- Keep the useful `Upload` action.
- Use the recovered space to show more media.

### Grid and pagination
- Make media items slightly smaller.
- Use a 3-column grid.
- Fit as much media as reasonably possible on one page.
- Do not make users scroll through a long media grid.
- Use additional paginated pages instead.
- Existing Next Page pagination works well; preserve it.
- Preserve the existing Upload tile/action that appears when appropriate.

### Media preview
- Users should still be able to deliberately tap media to preview it full-screen.
- Current photo and video preview behavior can overflow beyond the viewport.
- The user can currently be forced to scroll sideways just to reach the X/close control.
- Fix both photo and video preview layouts so:
  - the preview stays within the viewport;
  - its relevant information/controls fit on that screen;
  - no horizontal scrolling is required;
  - no unnecessary vertical scrolling is required;
  - the X/close control is always immediately visible and reachable.
- The general concept of a full-screen video player is fine.

### Media-selection bugs
- BUG: `Add selected media` can automatically open and play the selected video.
- Adding selected media should **only attach it**.
- Opening/playing media should require a separate deliberate preview action.
- BUG: media/video can also reopen without the user intentionally opening it. Fix this.

### Attached-media info
- Remove the redundant right-side text such as `1 asset attached`.

### KEEP
- `Original context` is fine.
- `Caption options` are good as-is.
- Caption Options scrolling feels slightly odd, but the user explicitly considered it acceptable. Do not redesign this area solely because of that.

---

## 2. Upload — Choose Accounts

### Header
Final header content should effectively be:
- `Choose accounts`
- dynamic selection count such as `0 of 6 accounts selected`

Remove the extra explanatory line such as:
- `Choose the platforms and connect`

### Selection behavior
- Preserve the selected-account count; it works.
- BUG/PERFORMANCE: account deselection can take a very long time.
- Selection and deselection should respond promptly.

### Account density
- Make each account entry/card more compact.
- Fit more accounts into the visible page.
- Reduce how much vertical scrolling is required.
- This must remain usable for customers with substantially more connected accounts than the current test account.
- Preserve the useful account/network/platform identification that currently tells the user what/where each account is.

---

## 3. Processing State

The current processing state is too opaque.

If the processing pipeline exposes meaningful progress/stages:
- add a loading/progress indicator and/or changing status text;
- update it according to what the system is actually doing;
- let the user see meaningful progression rather than staring at an unexplained processing screen.

The desired experience is conceptually similar to an AI interface exposing its current stage of work.

Do not invent misleading fake progress if real progress/stage information can be surfaced.

---

## 4. Upload — Main Review/Edit Page

### Remove top summary bars
Remove the three redundant bars/cards at the top:
- `Destinations selected`
- `Ready`
- `Needs attention`

Move the useful content upward into the recovered space.

### KEEP
Preserve:
- the `No spoken dialogue was detected` warning;
- Media Preview;
- the Destinations selector;
- the ability to tap/switch between destinations.

These were explicitly considered useful/good.

### Destination scroller — minor/non-blocking polish
There is a small visual clipping issue in the horizontal destination selector:
- destination content disappears behind an inset/border before reaching the apparent visual end;
- ideally it should scroll all the way to the visible end of the line and then clip cleanly on both sides.

This was explicitly described as minor and not worth destabilizing the otherwise-good selector. Fix it only if it can be done safely.

---

## 5. Caption UI Simplification

Below Destinations there is currently a redundant destination/caption information container.

Remove redundant elements such as:
- selected account/person + platform label repeated again there;
- `Disable destination`;
- `AI generated`;
- separate character-count area;
- Reset;
- Regenerate;
- the surrounding redundant container/box.

The raw review briefly considered retaining Regenerate, then explicitly reversed that decision. **Remove Regenerate.**

### Final caption UI
Keep only:
- `Caption` header;
- caption text box;
- character count **inside** the caption box.

Do not remove the actual caption editor.

---

## 6. Platform Comments/Posts + Advanced Settings

This area currently duplicates destination/network selection. The final decision is to have **one destination selector only**.

### Single destination selector
Use the existing Destinations selector directly beneath Media Preview as the single source of destination/network selection.

The destination selected there must control all destination-specific editing for:
- Caption;
- Platform Comments/Posts;
- Advanced Settings.

There should not be another independent network selector farther down the page.

### Physically consolidate the destination-specific controls
Move/organize **Platform Comments/Posts and Advanced Settings into the same destination-specific section beneath/associated with the existing Destinations selector**.

This is not merely shared state behind two separate UIs. The goal is to eliminate the duplicated lower destination/version navigation and make the existing upper Destinations control govern the related controls below it.

### Remove duplicate/version navigation
Remove:
- `Review versions`;
- `Global version` selector/card;
- duplicate individual-platform/network scrolling boxes;
- the second destination/network selector;
- `Editing a specific Network`;
- `Back to Global`.

### Destination-switching bug
- BUG: switching/clicking a different account/network in this lower area currently opens the video.
- Changing destinations/networks must **not** open or play the media.
- Media preview should open only when the user explicitly asks to preview media.

### Platform Comments
Simplify the Platform Comment editor.

Keep:
- the actual Platform Comment content/input;
- a Delete control for removing an existing comment;
- the lower `Add platform comment` action so a user can add another comment.

Remove the unnecessary overloaded controls/content that currently appear around the comment editor, including:
- image references;
- Generate Post(s);
- Generate Carousel;
- signature controls;
- underline;
- bold;
- other tiny formatting/generation UI serving the same cluttered auxiliary role.

The desired result is a straightforward platform-comment editor, not the current miniature overloaded editor.

### Advanced Settings
- Advanced Settings should be part of this same destination-specific flow.
- It must respond to the single Destinations selector above.
- Do not create or retain another Advanced-Settings-specific network selector.

---

## 7. Remove the Final Confirmation Page

The separate final page asking the user to confirm everything is unnecessary.

- Remove that final confirmation step/page.
- Bring `Post` / `Schedule` controls back into the main review/edit page.
- The user should be able to finish the workflow from that page without advancing into a redundant confirmation page.

---

## 8. Composer State Persistence — HIGH PRIORITY

Current serious failure:
- the user navigated from the composer to Schedule;
- returned to Upload;
- all composer work was gone.

This must be fixed.

### Required persistence
Preserve in-progress composer state when:
- navigating to another EverywherePoster menu/page and returning;
- reloading the page;
- accidentally closing/leaving the app/page and reopening it within a reasonable short recovery window.

State should include the meaningful progress already made in the composer, not merely which step the user was on.

### Expiration
- Immediate state destruction is unacceptable.
- If temporary composer state needs an expiration, losing it after roughly **30 minutes away** was considered acceptable.
- A 30-minute expiry is therefore an acceptable fallback/limit, **not a requirement to deliberately delete state at 30 minutes if longer persistence is safe and appropriate**.

### Data-loss behavior
- Routine internal navigation or reload should preserve the work.
- Do not silently discard substantial composer progress.
- If some action genuinely cannot preserve state and would destroy it, warn the user **before** the destructive transition.
- Persistence is preferred over relying on warnings.

---

## 9. Calendar / Scheduled Page

Remove the entire Channels block from Calendar/Scheduled.

This specifically includes:
- `Channels` heading;
- `Add Channel`;
- the link button/icon beside Add Channel;
- `Create Post`;
- the connected-account/channel list beneath it.

Then:
- move the `Scheduled` / `All Posts` tabs upward to the top;
- retain those two tabs as the primary top navigation.

Desired result: a much cleaner Scheduled/Calendar page without the large channel-management area.

---

## 10. Main Media Page

This is separate from the Upload-page media picker.

### Top layout
- There is too much wasted space at the top.
- Reuse the clean tab treatment already used on Scheduled.
- Put these two tabs at the top:
  - `Media Library`
  - `Posted Media`

### Media Library bug
- BUG: Media Library content is not appearing.
- Fix it so the Media Library actually displays its content.

### Posted Media
The raw review initially questioned whether Posted Media was also broken, then verified that it **does display**.

Therefore:
- do not treat Posted Media as a missing-content bug;
- preserve its working media display.

### Connected-platform/channel list
The connected-platform list is currently extremely tall and makes Posted Media difficult to use.

- Condense the connected-account/channel list substantially.
- Expect users to have even more connected accounts in the future.
- Selecting a channel should allow the user to see that channel's media without having to scroll far down the page first.
- The account selector must not dominate the screen.

### Connected platform videos
- Keep the `Connected platform videos` heading.
- Remove its unnecessary explanatory subtext because the heading is already self-explanatory.

---

## 11. More Tab / Menu

### KEEP
- Keep `Add Channel`.
- Keep its link affordance/icon.
- Preserve the popup/menu's overall layout; the user explicitly liked it.

### Fix spacing
- The Add Channel area/button currently extends too close/all the way to the edge of the screen.
- Give it the same consistent inset/border treatment used elsewhere in the UI.

### Fix menu border/radius
- The popup/menu should have clean rounded top corners.
- It may technically already have rounding, but the current border/overlap makes it appear incorrect.
- Fix the overlapping/incorrect top-border treatment.

### Remove redundant title
- Remove the `More` title/header inside this view/menu.
- It is unnecessary because the user's location is already clear.

### Close button
- Make the X/close icon somewhat larger and easier to use.

---

## 12. Agent Page

### Lock the page; scroll the conversation
The same unnecessary page-scrolling problem exists here.

- The overall Agent page should stay locked in place when its layout fits the viewport.
- Chat history should remain scrollable.
- Scrolling chat history must not move the input/composer.
- The chat input/composer should remain fixed in place.

### Simplify the bottom area
- Remove the unnecessary auxiliary buttons around the bottom/input area.
- Remove the unnecessary divider/line directly above the chat box.
- Keep the chat box itself.
- Preserve essential send/stop functionality described below.

### Input-focus zoom/layout bug
- BUG: focusing/tapping into the chat box currently zooms the page and breaks the layout.
- Prevent that unwanted zoom/layout shift.
- Closing/unfocusing the input must not leave the UI displaced.
- The layout should return/remain in its correct position.

### First-message spacing bug
- BUG: the **first sent user message** has incorrect spacing.
- Its message bubble/text sits almost against the lower reaction/action icons, particularly the thumbs-down icon.
- Later sent messages have correct spacing.
- Make the first message use the same appropriate spacing as subsequent messages.

### Stop button
The active Stop control currently looks like an unexplained square.

- Keep the square stop symbol.
- Put it inside a clear **white circular button/background** so its purpose/control boundary is obvious.

### Send button
- Put the Send arrow inside a matching clear **white circular button/background** so it is easy to see.

---

## 13. Analytics — OUT OF SCOPE

Analytics was identified as needing substantial UI work, but the review explicitly stopped before defining those changes.

- Do **not** attempt to infer or implement an Analytics redesign from this document.
- Handle Analytics in a separate review/batch later.

---

# Definition of Done / Verification

This batch is not complete merely because the components compile.

Verify the affected experience end-to-end, including the mobile-sized viewport where these issues are visible.

At minimum verify:

1. Initial Upload page no longer has unintended app-layout scrolling when its content fits.
2. Upload Media Library is locked to the viewport, uses the intended condensed 3-column/paginated presentation, and does not drift horizontally/vertically.
3. Photo and video previews never require horizontal scrolling to reach controls or the X.
4. Adding selected media does not auto-open or auto-play it.
5. Media does not spontaneously reopen.
6. Choose Accounts has the simplified header/count and selection/deselection is responsive.
7. Account cards are condensed without removing useful account/platform identification.
8. Processing state exposes meaningful progress when real pipeline state allows it.
9. The three top review summary bars are gone.
10. Spoken-dialogue warning, Media Preview, and the good Destinations selector remain intact.
11. Caption area is reduced to Caption header + editor + in-editor character count.
12. Reset, Regenerate, Disable Destination, AI-generated label, duplicated account/platform header, and their redundant container are removed.
13. There is only **one** destination selector for Caption + Platform Comments/Posts + Advanced Settings.
14. Platform Comments/Posts and Advanced Settings are consolidated beneath/with that destination flow rather than maintaining a second version/network-navigation area.
15. Switching destinations does not open/play media.
16. Platform Comment UI contains the required comment content, Delete, and Add Platform Comment behavior without the removed auxiliary clutter.
17. Final confirmation page is removed and Post/Schedule actions are available on the main review/edit page.
18. Composer work survives internal navigation and return.
19. Composer work survives page reload.
20. Composer work survives a short accidental close/reopen recovery case rather than disappearing immediately.
21. Scheduled/Calendar no longer contains the Channels/Add Channel/link/Create Post/account-list block, and Scheduled/All Posts sit at the top.
22. Main Media page has top-level Media Library/Posted Media tabs in the Scheduled-style treatment.
23. Media Library actually displays content.
24. Existing working Posted Media behavior remains intact.
25. Connected-platform selectors are condensed enough that they do not push selected media far down the screen.
26. `Connected platform videos` remains while its redundant subtext is removed.
27. More retains Add Channel/link/menu layout while fixing edge spacing, top rounding/border, redundant More title, and small X.
28. Agent outer page remains stable while chat history alone can scroll and the input stays fixed.
29. Agent input focus no longer causes destructive zoom/layout displacement.
30. The first sent message uses correct spacing around its reaction/action controls.
31. Send and Stop controls use the requested white circular backgrounds.
32. Analytics remains untouched by this batch.
33. Components explicitly marked **KEEP** were not unnecessarily redesigned or broken.

Run the relevant automated tests plus direct UI verification. Fix regressions discovered during verification rather than treating the first passing implementation as complete.
